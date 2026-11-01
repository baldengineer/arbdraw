import importlib.resources
import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from python_bridge.windows_tray import (
    BridgeController,
    BridgeState,
    HealthInfo,
    find_bridge_executable,
    probe_bridge,
    tray_icon_resource_name,
)


class FakeProcess:
    def __init__(self, pid):
        self.pid = pid
        self.exit_code = None
        self.terminate_calls = 0

    def poll(self):
        return self.exit_code

    def terminate(self):
        self.terminate_calls += 1
        self.exit_code = 0


class FakeProcessFactory:
    def __init__(self):
        self.calls = []
        self.processes = []

    def __call__(self, command, **options):
        process = FakeProcess(4100 + len(self.processes))
        self.calls.append((command, options))
        self.processes.append(process)
        return process


class WindowsTrayControllerTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parent
        self.executable = Path(__file__).resolve()
        self.health = None
        self.factory = FakeProcessFactory()
        self.clock_value = 100.0
        self.terminated_pids = []
        self.controller = BridgeController(
            executable=str(self.executable),
            bridge_args=("--port", "8876"),
            log_path=self.root / "bridge.log",
            health_probe=lambda: self.health,
            process_factory=self.factory,
            pid_terminator=self.terminated_pids.append,
            clock=lambda: self.clock_value,
            log_opener=lambda: io.BytesIO(),
            installed_version="0.1.4",
            installed_adapters=("tekscope-mso6", "owon-xdg3000"),
        )

    def test_starts_sibling_executable_without_a_console(self):
        self.assertTrue(self.controller.start())
        self.assertEqual(self.controller.state, BridgeState.STARTING)
        command, options = self.factory.calls[0]
        self.assertEqual(command, [str(self.executable), "--port", "8876"])
        self.assertEqual(options["cwd"], str(self.root))

        self.health = HealthInfo(
            pid=self.factory.processes[0].pid,
            version="0.1.5",
            adapters=("rigol-dg1022",),
        )
        self.assertEqual(self.controller.refresh(), BridgeState.RUNNING)
        self.assertTrue(self.controller.can_stop)
        self.assertEqual(self.controller.version, "0.1.5")
        self.assertEqual(self.controller.adapters, ("rigol-dg1022",))

    def test_stop_and_restart_managed_process(self):
        self.controller.start()
        first = self.factory.processes[0]
        self.health = HealthInfo(first.pid)
        self.controller.refresh()

        self.assertTrue(self.controller.restart())
        self.assertEqual(first.terminate_calls, 1)
        self.assertEqual(self.controller.state, BridgeState.STOPPING)
        self.health = None
        self.controller.refresh()

        self.assertEqual(len(self.factory.processes), 2)
        self.assertEqual(self.controller.state, BridgeState.STARTING)

    def test_can_stop_and_restart_bridge_started_elsewhere(self):
        self.health = HealthInfo(9876)
        self.assertEqual(self.controller.refresh(), BridgeState.RUNNING_EXTERNAL)

        self.assertTrue(self.controller.restart())
        self.assertEqual(self.terminated_pids, [9876])
        self.assertEqual(self.controller.state, BridgeState.STOPPING)
        self.health = None
        self.controller.refresh()

        self.assertEqual(len(self.factory.processes), 1)
        self.assertEqual(self.controller.state, BridgeState.STARTING)

    def test_failed_start_exposes_actionable_error(self):
        controller = BridgeController(
            executable=str(self.root / "missing.exe"),
            log_path=self.root / "bridge.log",
            health_probe=lambda: None,
            log_opener=lambda: io.BytesIO(),
        )
        self.assertFalse(controller.start())
        self.assertEqual(controller.state, BridgeState.ERROR)
        self.assertIn("Could not find", controller.detail)

    def test_close_only_stops_process_owned_by_the_app(self):
        self.controller.start()
        process = self.factory.processes[0]
        self.controller.close()
        self.assertEqual(process.terminate_calls, 1)

        external = BridgeController(
            health_probe=lambda: HealthInfo(777),
            pid_terminator=self.terminated_pids.append,
        )
        external.refresh()
        external.close()
        self.assertEqual(self.terminated_pids, [])

    def test_finds_explicit_executable(self):
        self.assertEqual(find_bridge_executable(str(self.executable)), self.executable.resolve())


class ProbeBridgeTests(unittest.TestCase):
    def test_accepts_only_identified_bridge_health(self):
        class Response:
            def __init__(self, payload):
                self.payload = payload

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return json.dumps(self.payload).encode()

        with patch(
            "python_bridge.tray_controller.urlopen",
            return_value=Response(
                {
                    "service": "arbdraw-python-bridge",
                    "pid": 42,
                    "version": "0.1.4",
                    "adapters": ["tekscope-mso6", "owon-xdg3000"],
                }
            ),
        ):
            self.assertEqual(
                probe_bridge("http://127.0.0.1:8876"),
                HealthInfo(42, "0.1.4", ("owon-xdg3000", "tekscope-mso6")),
            )

        with patch(
            "python_bridge.tray_controller.urlopen",
            return_value=Response({"service": "something-else", "pid": 42}),
        ):
            self.assertIsNone(probe_bridge("http://127.0.0.1:8876"))

    def test_favicon_is_packaged_with_the_bridge(self):
        package = importlib.resources.files("python_bridge")
        self.assertTrue(package.joinpath("ArbDraw.ico").is_file())
        self.assertTrue(package.joinpath("ArbDraw-gray.ico").is_file())

    def test_icon_color_tracks_running_state(self):
        self.assertEqual(tray_icon_resource_name(BridgeState.STOPPED), "ArbDraw-gray.ico")
        self.assertEqual(tray_icon_resource_name(BridgeState.STARTING), "ArbDraw-gray.ico")
        self.assertEqual(tray_icon_resource_name(BridgeState.STOPPING), "ArbDraw-gray.ico")
        self.assertEqual(tray_icon_resource_name(BridgeState.ERROR), "ArbDraw-gray.ico")
        self.assertEqual(tray_icon_resource_name(BridgeState.RUNNING), "ArbDraw.ico")
        self.assertEqual(
            tray_icon_resource_name(BridgeState.RUNNING_EXTERNAL), "ArbDraw.ico"
        )


if __name__ == "__main__":
    unittest.main()
