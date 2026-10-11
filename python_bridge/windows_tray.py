"""Windows notification-area controller for ``arbdraw-bridge.exe``.

The package installs this module as the windowed ``arbdraw-bridge-tray.exe``
entry point.  Win32 is accessed through ctypes so the controller does not add a
desktop-framework dependency to the bridge.
"""

from __future__ import annotations

import argparse
import ctypes
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
    return HealthInfo(pid=pid)


def find_bridge_executable(explicit: str | None = None) -> Path:
    """Find the console launcher installed beside this tray launcher."""

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
                Path(sys.argv[0]).resolve().with_name("arbdraw-bridge.exe"),
                Path(sys.executable).resolve().with_name("arbdraw-bridge.exe"),
                Path(sys.executable).resolve().parent / "Scripts" / "arbdraw-bridge.exe",
            )
        )
        located = shutil.which("arbdraw-bridge.exe")
        if located:
            candidates.append(Path(located))
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    requested = explicit or "arbdraw-bridge.exe"
    raise FileNotFoundError(
        f"Could not find {requested}. Install the tray app in the same Python "
        "environment as the ArbDraw bridge, or pass --bridge with its path."
    )


class BridgeController:
    """Process lifecycle logic kept independent from the Win32 tray UI."""

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


def default_log_path() -> Path:
    root = os.environ.get("LOCALAPPDATA")
    return (Path(root) / "ArbDraw" if root else Path.home() / ".arbdraw") / "bridge.log"


def run_tray(controller: BridgeController) -> int:
    """Run the native Windows notification-area message loop."""

    if sys.platform != "win32":
        raise RuntimeError("The ArbDraw bridge tray app is available only on Windows.")

    from ctypes import wintypes

    user32 = ctypes.windll.user32
    shell32 = ctypes.windll.shell32
    kernel32 = ctypes.windll.kernel32

    WM_DESTROY = 0x0002
    WM_CLOSE = 0x0010
    WM_NULL = 0x0000
    WM_TIMER = 0x0113
    WM_LBUTTONUP = 0x0202
    WM_RBUTTONUP = 0x0205
    WM_CONTEXTMENU = 0x007B
    WM_APP = 0x8000
    TRAY_CALLBACK = WM_APP + 1
    NIM_ADD, NIM_MODIFY, NIM_DELETE = 0, 1, 2
    NIF_MESSAGE, NIF_ICON, NIF_TIP, NIF_INFO = 1, 2, 4, 0x10
    MF_STRING, MF_GRAYED, MF_SEPARATOR = 0, 1, 0x800
    TPM_RIGHTBUTTON, TPM_RETURNCMD = 2, 0x100
    IDI_APPLICATION, IDI_ERROR, IDI_INFORMATION = 32512, 32513, 32516
    CMD_START, CMD_STOP, CMD_RESTART, CMD_EXIT = 1001, 1002, 1003, 1099
    ERROR_ALREADY_EXISTS = 183

    class WNDCLASSW(ctypes.Structure):
        pass

    WNDPROC = ctypes.WINFUNCTYPE(
        ctypes.c_ssize_t, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
    )
    WNDCLASSW._fields_ = [
        ("style", wintypes.UINT),
        ("lpfnWndProc", WNDPROC),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", wintypes.HINSTANCE),
        ("hIcon", wintypes.HICON),
        ("hCursor", wintypes.HANDLE),
        ("hbrBackground", wintypes.HBRUSH),
        ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR),
    ]

    class NOTIFYICONDATAW(ctypes.Structure):
        _fields_ = [
            ("cbSize", wintypes.DWORD),
            ("hWnd", wintypes.HWND),
            ("uID", wintypes.UINT),
            ("uFlags", wintypes.UINT),
            ("uCallbackMessage", wintypes.UINT),
            ("hIcon", wintypes.HICON),
            ("szTip", wintypes.WCHAR * 128),
            ("dwState", wintypes.DWORD),
            ("dwStateMask", wintypes.DWORD),
            ("szInfo", wintypes.WCHAR * 256),
            ("uTimeoutOrVersion", wintypes.UINT),
            ("szInfoTitle", wintypes.WCHAR * 64),
            ("dwInfoFlags", wintypes.DWORD),
            ("guidItem", ctypes.c_byte * 16),
            ("hBalloonIcon", wintypes.HICON),
        ]

    class POINT(ctypes.Structure):
        _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]

    class MSG(ctypes.Structure):
        _fields_ = [
            ("hWnd", wintypes.HWND),
            ("message", wintypes.UINT),
            ("wParam", wintypes.WPARAM),
            ("lParam", wintypes.LPARAM),
            ("time", wintypes.DWORD),
            ("pt", POINT),
        ]

    # ctypes defaults native calls to 32-bit integer results. Declare the
    # pointer-sized Win32 handles explicitly so the tray also works in 64-bit
    # Python processes.
    kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    kernel32.CreateMutexW.restype = wintypes.HANDLE
    kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetModuleHandleW.restype = wintypes.HMODULE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    user32.LoadIconW.argtypes = [wintypes.HINSTANCE, ctypes.c_void_p]
    user32.LoadIconW.restype = wintypes.HICON
    user32.CreatePopupMenu.restype = wintypes.HMENU
    user32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASSW)]
    user32.RegisterClassW.restype = wintypes.ATOM
    user32.CreateWindowExW.argtypes = [
        wintypes.DWORD,
        wintypes.LPCWSTR,
        wintypes.LPCWSTR,
        wintypes.DWORD,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.HWND,
        wintypes.HMENU,
        wintypes.HINSTANCE,
        ctypes.c_void_p,
    ]
    user32.CreateWindowExW.restype = wintypes.HWND
    user32.DefWindowProcW.argtypes = [
        wintypes.HWND,
        wintypes.UINT,
        wintypes.WPARAM,
        wintypes.LPARAM,
    ]
    user32.DefWindowProcW.restype = ctypes.c_ssize_t
    user32.PostMessageW.argtypes = [
        wintypes.HWND,
        wintypes.UINT,
        wintypes.WPARAM,
        wintypes.LPARAM,
    ]
    user32.PostMessageW.restype = wintypes.BOOL
    user32.DestroyWindow.argtypes = [wintypes.HWND]
    user32.DestroyWindow.restype = wintypes.BOOL
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    user32.SetForegroundWindow.restype = wintypes.BOOL
    user32.CreatePopupMenu.argtypes = []
    user32.AppendMenuW.argtypes = [
        wintypes.HMENU,
        wintypes.UINT,
        ctypes.c_size_t,
        wintypes.LPCWSTR,
    ]
    user32.AppendMenuW.restype = wintypes.BOOL
    user32.TrackPopupMenu.argtypes = [
        wintypes.HMENU,
        wintypes.UINT,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.HWND,
        ctypes.c_void_p,
    ]
    user32.TrackPopupMenu.restype = wintypes.UINT
    user32.DestroyMenu.argtypes = [wintypes.HMENU]
    user32.DestroyMenu.restype = wintypes.BOOL
    user32.SetTimer.argtypes = [wintypes.HWND, ctypes.c_size_t, wintypes.UINT, ctypes.c_void_p]
    user32.SetTimer.restype = ctypes.c_size_t
    user32.GetCursorPos.argtypes = [ctypes.POINTER(POINT)]
    user32.GetCursorPos.restype = wintypes.BOOL
    user32.GetMessageW.argtypes = [
        ctypes.POINTER(MSG),
        wintypes.HWND,
        wintypes.UINT,
        wintypes.UINT,
    ]
    user32.GetMessageW.restype = wintypes.BOOL
    user32.TranslateMessage.argtypes = [ctypes.POINTER(MSG)]
    user32.TranslateMessage.restype = wintypes.BOOL
    user32.DispatchMessageW.argtypes = [ctypes.POINTER(MSG)]
    user32.DispatchMessageW.restype = ctypes.c_ssize_t
    user32.PostQuitMessage.argtypes = [ctypes.c_int]
    user32.MessageBoxW.argtypes = [
        wintypes.HWND,
        wintypes.LPCWSTR,
        wintypes.LPCWSTR,
        wintypes.UINT,
    ]
    user32.MessageBoxW.restype = ctypes.c_int
    shell32.Shell_NotifyIconW.argtypes = [wintypes.DWORD, ctypes.POINTER(NOTIFYICONDATAW)]
    shell32.Shell_NotifyIconW.restype = wintypes.BOOL

    mutex = kernel32.CreateMutexW(None, False, "Local\\ArbDrawBridgeTray")
    if not mutex or kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
        user32.MessageBoxW(None, "ArbDraw Bridge is already in the notification area.", "ArbDraw Bridge", 0x40)
        if mutex:
            kernel32.CloseHandle(mutex)
        return 0

    class_name = "ArbDrawBridgeTrayWindow"
    hinstance = kernel32.GetModuleHandleW(None)
    notify_data = NOTIFYICONDATAW()

    def icon_for_state(state: BridgeState):
        icon_id = IDI_INFORMATION if state in (BridgeState.RUNNING, BridgeState.RUNNING_EXTERNAL) else IDI_APPLICATION
        if state == BridgeState.ERROR:
            icon_id = IDI_ERROR
        return user32.LoadIconW(None, icon_id)

    def update_icon(balloon: bool = False) -> None:
        notify_data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
        notify_data.hIcon = icon_for_state(controller.state)
        notify_data.szTip = f"ArbDraw Bridge — {controller.status_text}"[:127]
        if balloon:
            notify_data.uFlags |= NIF_INFO
            notify_data.szInfoTitle = "ArbDraw Bridge"
            notify_data.szInfo = controller.detail[:255]
            notify_data.dwInfoFlags = 3 if controller.state == BridgeState.ERROR else 1
        shell32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(notify_data))

    def run_command(command: int) -> None:
        if command == CMD_START:
            controller.start()
        elif command == CMD_STOP:
            controller.stop()
        elif command == CMD_RESTART:
            controller.restart()
        elif command == CMD_EXIT:
            user32.PostMessageW(notify_data.hWnd, WM_CLOSE, 0, 0)
            return
        update_icon(balloon=controller.state == BridgeState.ERROR)

    def show_menu(hwnd) -> None:
        menu = user32.CreatePopupMenu()
        try:
            user32.AppendMenuW(menu, MF_STRING | MF_GRAYED, 0, f"Status: {controller.status_text}")
            user32.AppendMenuW(menu, MF_SEPARATOR, 0, None)
            user32.AppendMenuW(menu, MF_STRING | (0 if controller.can_start else MF_GRAYED), CMD_START, "Start bridge")
            user32.AppendMenuW(menu, MF_STRING | (0 if controller.can_stop else MF_GRAYED), CMD_STOP, "Stop bridge")
            user32.AppendMenuW(
                menu,
                MF_STRING | (0 if controller.can_restart else MF_GRAYED),
                CMD_RESTART,
                "Restart bridge",
            )
            user32.AppendMenuW(menu, MF_SEPARATOR, 0, None)
            user32.AppendMenuW(menu, MF_STRING, CMD_EXIT, "Exit")
            point = POINT()
            user32.GetCursorPos(ctypes.byref(point))
            user32.SetForegroundWindow(hwnd)
            command = user32.TrackPopupMenu(
                menu, TPM_RIGHTBUTTON | TPM_RETURNCMD, point.x, point.y, 0, hwnd, None
            )
            user32.PostMessageW(hwnd, WM_NULL, 0, 0)
            if command:
                run_command(command)
        finally:
            user32.DestroyMenu(menu)

    @WNDPROC
    def window_proc(hwnd, message, wparam, lparam):
        try:
            if message == TRAY_CALLBACK and lparam in (WM_LBUTTONUP, WM_RBUTTONUP, WM_CONTEXTMENU):
                show_menu(hwnd)
                return 0
            if message == WM_TIMER:
                previous = controller.state
                controller.refresh()
                update_icon(balloon=controller.state == BridgeState.ERROR and previous != BridgeState.ERROR)
                return 0
            if message == WM_CLOSE:
                user32.DestroyWindow(hwnd)
                return 0
            if message == WM_DESTROY:
                controller.close()
                shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(notify_data))
                user32.PostQuitMessage(0)
                return 0
        except Exception as error:  # Keep exceptions from escaping a native callback.
            controller.state = BridgeState.ERROR
            controller.detail = str(error)
            update_icon(balloon=True)
            return 0
        return user32.DefWindowProcW(hwnd, message, wparam, lparam)

    window_class = WNDCLASSW()
    window_class.lpfnWndProc = window_proc
    window_class.hInstance = hinstance
    window_class.lpszClassName = class_name
    if not user32.RegisterClassW(ctypes.byref(window_class)):
        raise ctypes.WinError()
    hwnd = user32.CreateWindowExW(0, class_name, "ArbDraw Bridge", 0, 0, 0, 0, 0, None, None, hinstance, None)
    if not hwnd:
        raise ctypes.WinError()

    controller.refresh()
    notify_data.cbSize = ctypes.sizeof(notify_data)
    notify_data.hWnd = hwnd
    notify_data.uID = 1
    notify_data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
    notify_data.uCallbackMessage = TRAY_CALLBACK
    notify_data.hIcon = icon_for_state(controller.state)
    notify_data.szTip = f"ArbDraw Bridge — {controller.status_text}"[:127]
    if not shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(notify_data)):
        raise ctypes.WinError()
    user32.SetTimer(hwnd, 1, 1000, None)

    message = MSG()
    while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
        user32.TranslateMessage(ctypes.byref(message))
        user32.DispatchMessageW(ctypes.byref(message))
    kernel32.CloseHandle(mutex)
    return int(message.wParam)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Control the ArbDraw Python bridge from the Windows notification area."
    )
    parser.add_argument("--bridge", help="Path or command name for arbdraw-bridge.exe.")
    parser.add_argument("--url", default=DEFAULT_BRIDGE_URL, help="Bridge base URL used for status checks.")
    parser.add_argument("bridge_args", nargs=argparse.REMAINDER, help="Arguments after -- are passed to the bridge.")
    arguments = parser.parse_args()
    bridge_args = arguments.bridge_args
    if bridge_args[:1] == ["--"]:
        bridge_args = bridge_args[1:]
    controller = BridgeController(
        bridge_url=arguments.url,
        executable=arguments.bridge,
        bridge_args=bridge_args,
    )
    try:
        raise SystemExit(run_tray(controller))
    except Exception as error:
        if sys.platform == "win32":
            ctypes.windll.user32.MessageBoxW(None, str(error), "ArbDraw Bridge", 0x10)
        else:
            parser.error(str(error))


if __name__ == "__main__":
    main()
