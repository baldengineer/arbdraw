"""Shared process and health controller for ArbDraw desktop status apps."""

from __future__ import annotations

import importlib.metadata
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Callable, Sequence
from urllib.request import urlopen


SERVICE_NAME = "arbdraw-python-bridge"
DEFAULT_BRIDGE_URL = "http://127.0.0.1:8876"


@dataclass(frozen=True)
class HealthInfo:
    """Identity returned by a healthy ArbDraw bridge."""

    pid: int
    version: str = "Unknown"
    adapters: tuple[str, ...] = ()


class BridgeState(Enum):
    STOPPED = "Stopped"
    STARTING = "Starting"
    RUNNING = "Running"
    RUNNING_EXTERNAL = "Running (started elsewhere)"
    STOPPING = "Stopping"
    ERROR = "Error"


def probe_bridge(base_url: str, timeout: float = 0.3) -> HealthInfo | None:
    """Return bridge identity only when the ArbDraw health contract matches."""

    health_url = f"{base_url.rstrip('/')}/api/v1/health"
    try:
        with urlopen(health_url, timeout=timeout) as response:
            payload = json.load(response)
    except (OSError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    pid = payload.get("pid")
    if payload.get("service") != SERVICE_NAME or not isinstance(pid, int) or pid <= 0:
        return None
    version = payload.get("version")
    if not isinstance(version, str) or not version.strip():
        version = "Unknown"
    adapters = payload.get("adapters")
    if not isinstance(adapters, list):
        adapters = []
    adapter_names = tuple(
        sorted(
            {name.strip() for name in adapters if isinstance(name, str) and name.strip()},
            key=str.casefold,
        )
    )
    return HealthInfo(pid=pid, version=version.strip(), adapters=adapter_names)


def installed_bridge_version() -> str:
    try:
        return importlib.metadata.version("arbdraw-python-bridge")
    except importlib.metadata.PackageNotFoundError:
        return "Unknown"


def installed_adapter_names() -> tuple[str, ...]:
    try:
        entry_points = importlib.metadata.entry_points()
        selected = (
            entry_points.select(group="arbdraw.instrument_adapters")
            if hasattr(entry_points, "select")
            else entry_points.get("arbdraw.instrument_adapters", ())
        )
        return tuple(sorted({entry_point.name for entry_point in selected}, key=str.casefold))
    except (AttributeError, TypeError):
        return ()


def bridge_launcher_name(platform: str | None = None) -> str:
    """Return the console-script name generated for the current platform."""

    return "arbdraw-bridge.exe" if (platform or sys.platform) == "win32" else "arbdraw-bridge"


def find_bridge_executable(
    explicit: str | None = None,
    *,
    launcher_name: str | None = None,
) -> Path:
    """Find the bridge console launcher installed beside the desktop launcher."""

    launcher = launcher_name or bridge_launcher_name()
    candidates: list[Path] = []
    if explicit:
        explicit_path = Path(explicit).expanduser()
        if explicit_path.parent != Path(".") or explicit_path.is_absolute():
            candidates.append(explicit_path)
        else:
            located = shutil.which(explicit)
            if located:
                candidates.append(Path(located))
    else:
        candidates.extend(
            (
                Path(sys.argv[0]).resolve().with_name(launcher),
                Path(sys.executable).resolve().with_name(launcher),
            )
        )
        if sys.platform == "win32":
            candidates.append(Path(sys.executable).resolve().parent / "Scripts" / launcher)
        located = shutil.which(launcher)
        if located:
            candidates.append(Path(located))
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    requested = explicit or launcher
    raise FileNotFoundError(
        f"Could not find {requested}. Install the desktop app in the same Python "
        "environment as the ArbDraw bridge, or pass --bridge with its path."
    )


def default_log_path(platform: str | None = None) -> Path:
    """Use the conventional per-user log directory on each desktop platform."""

    current_platform = platform or sys.platform
    if current_platform == "win32":
        root = os.environ.get("LOCALAPPDATA")
        return (Path(root) / "ArbDraw" if root else Path.home() / ".arbdraw") / "bridge.log"
    if current_platform == "darwin":
        return Path.home() / "Library" / "Logs" / "ArbDraw" / "bridge.log"
    return Path.home() / ".arbdraw" / "bridge.log"


class BridgeController:
    """Process lifecycle logic shared by the platform-specific desktop UIs."""

    def __init__(
        self,
        bridge_url: str = DEFAULT_BRIDGE_URL,
        executable: str | None = None,
        bridge_args: Sequence[str] = (),
        log_path: Path | None = None,
        *,
        health_probe: Callable[[], HealthInfo | None] | None = None,
        process_factory: Callable[..., subprocess.Popen] = subprocess.Popen,
        pid_terminator: Callable[[int], None] | None = None,
        clock: Callable[[], float] = time.monotonic,
        log_opener: Callable[[], object] | None = None,
        installed_version: str | None = None,
        installed_adapters: Sequence[str] | None = None,
    ):
        self.bridge_url = bridge_url
        self.executable = executable
        self.bridge_args = tuple(bridge_args)
        self.log_path = log_path or default_log_path()
        self._health_probe = health_probe or (lambda: probe_bridge(self.bridge_url))
        self._process_factory = process_factory
        self._pid_terminator = pid_terminator or self._terminate_pid
        self._clock = clock
        self._log_opener = log_opener or (lambda: self.log_path.open("ab"))
        self._process: subprocess.Popen | None = None
        self._managed_pid: int | None = None
        self._external_pid: int | None = None
        self._started_at = 0.0
        self._restart_pending = False
        self.version = installed_version or installed_bridge_version()
        self.adapters = tuple(
            sorted(
                installed_adapters if installed_adapters is not None else installed_adapter_names(),
                key=str.casefold,
            )
        )
        self.state = BridgeState.STOPPED
        self.detail = "Bridge is not running."

    @staticmethod
    def _terminate_pid(pid: int) -> None:
        os.kill(pid, signal.SIGTERM)

    @property
    def can_start(self) -> bool:
        return self.state in (BridgeState.STOPPED, BridgeState.ERROR)

    @property
    def can_stop(self) -> bool:
        return self.state in (
            BridgeState.STARTING,
            BridgeState.RUNNING,
            BridgeState.RUNNING_EXTERNAL,
        )

    @property
    def can_restart(self) -> bool:
        return self.can_stop

    @property
    def status_text(self) -> str:
        return self.state.value

    def refresh(self) -> BridgeState:
        health = self._health_probe()
        if health is not None:
            self.version = health.version
            self.adapters = health.adapters
        process = self._process
        if process is not None and process.poll() is None:
            self._managed_pid = process.pid
            self._external_pid = None
            if self.state == BridgeState.STOPPING:
                self.detail = "Stopping the bridge."
            elif health and health.pid == process.pid:
                self.state = BridgeState.RUNNING
                self.detail = f"Bridge is running (PID {process.pid})."
            elif self._clock() - self._started_at < 10:
                self.state = BridgeState.STARTING
                self.detail = "Waiting for the bridge health endpoint."
            else:
                self.state = BridgeState.RUNNING
                self.detail = f"Process {process.pid} is running, but health is unavailable."
            return self.state

        if process is not None:
            exit_code = process.poll()
            self._process = None
            self._managed_pid = None
            if health and health.pid == process.pid:
                self.state = BridgeState.STOPPING
                self.detail = "Waiting for the bridge endpoint to close."
                return self.state
            if self._restart_pending and health is None:
                self._restart_pending = False
                self._start_new_process()
                return self.state
            if self.state != BridgeState.STOPPING and exit_code:
                self.state = BridgeState.ERROR
                self.detail = f"Bridge exited with code {exit_code}. See {self.log_path}."
                return self.state

        if health is not None:
            if self.state == BridgeState.STOPPING and health.pid == self._external_pid:
                self.detail = f"Stopping bridge process {health.pid}."
            else:
                self.state = BridgeState.RUNNING_EXTERNAL
                self._external_pid = health.pid
                self.detail = f"Bridge is running outside this app (PID {health.pid})."
            return self.state

        self._external_pid = None
        if self._restart_pending:
            self._restart_pending = False
            self._start_new_process()
        elif self.state != BridgeState.ERROR:
            self.state = BridgeState.STOPPED
            self.detail = "Bridge is not running."
        return self.state

    def start(self) -> bool:
        health = self._health_probe()
        if health is not None:
            self.version = health.version
            self.adapters = health.adapters
            self._external_pid = health.pid
            self.state = BridgeState.RUNNING_EXTERNAL
            self.detail = f"Bridge is already running (PID {health.pid})."
            return False
        if self._process is not None and self._process.poll() is None:
            return False
        return self._start_new_process()

    def _start_new_process(self) -> bool:
        try:
            executable = find_bridge_executable(self.executable)
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self._log_opener() as log:
                header = time.strftime("\n[%Y-%m-%d %H:%M:%S] Starting bridge\n").encode()
                log.write(header)
                log.flush()
                self._process = self._process_factory(
                    [str(executable), *self.bridge_args],
                    cwd=str(executable.parent),
                    stdin=subprocess.DEVNULL,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
        except (OSError, ValueError) as error:
            self._process = None
            self.state = BridgeState.ERROR
            self.detail = str(error)
            return False
        self._managed_pid = self._process.pid
        self._external_pid = None
        self._started_at = self._clock()
        self.state = BridgeState.STARTING
        self.detail = f"Starting bridge process {self._managed_pid}."
        return True

    def stop(self) -> bool:
        process = self._process
        try:
            if process is not None and process.poll() is None:
                process.terminate()
            elif self._external_pid is not None:
                # Re-check the health contract immediately before terminating
                # a process so a stale PID cannot target a reused process ID.
                health = self._health_probe()
                if health is None or health.pid != self._external_pid:
                    self._external_pid = None
                    self.state = BridgeState.STOPPED
                    self.detail = "Bridge is not running."
                    return False
                self._pid_terminator(health.pid)
            else:
                return False
        except OSError as error:
            self.state = BridgeState.ERROR
            self.detail = f"Could not stop the bridge: {error}"
            return False
        self.state = BridgeState.STOPPING
        self.detail = "Stopping the bridge."
        return True

    def restart(self) -> bool:
        if not self.can_restart:
            return self.start()
        self._restart_pending = True
        if not self.stop():
            self._restart_pending = False
            self.refresh()
            return self.start() if self.can_start else False
        return True

    def close(self) -> None:
        """Stop a bridge owned by this app; leave externally started bridges alone."""

        if self._process is not None and self._process.poll() is None:
            try:
                self._process.terminate()
            except OSError:
                pass
