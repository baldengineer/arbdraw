import unittest
from pathlib import Path
from unittest.mock import patch

from python_bridge.macos_menu_bar import default_lock_path, menu_state
from python_bridge.tray_controller import (
    BridgeController,
    BridgeState,
    HealthInfo,
    bridge_launcher_name,
    default_log_path,
)


class MacOSMenuBarTests(unittest.TestCase):
    def test_menu_snapshot_tracks_controller_state_and_actions(self):
        health = None
        controller = BridgeController(
            health_probe=lambda: health,
            installed_version="0.1.5",
            installed_adapters=("tekscope-mso6", "owon-xdg3000"),
        )

        stopped = menu_state(controller)
        self.assertEqual(stopped.status, "Stopped")
        self.assertEqual(stopped.adapters, ("owon-xdg3000", "tekscope-mso6"))
        self.assertTrue(stopped.can_start)
        self.assertFalse(stopped.can_stop)
        self.assertFalse(stopped.running)

        health = HealthInfo(42, "0.1.6", ("rigol-dg1022",))
        self.assertEqual(controller.refresh(), BridgeState.RUNNING_EXTERNAL)
        running = menu_state(controller)
        self.assertEqual(running.status, "Running (started elsewhere)")
        self.assertEqual(running.version, "0.1.6")
        self.assertEqual(running.adapters, ("rigol-dg1022",))
        self.assertFalse(running.can_start)
        self.assertTrue(running.can_stop)
        self.assertTrue(running.can_restart)
        self.assertTrue(running.running)

    def test_uses_macos_launcher_and_user_library_paths(self):
        with patch.object(Path, "home", return_value=Path("/Users/tester")):
            self.assertEqual(
                default_log_path("darwin"),
                Path("/Users/tester/Library/Logs/ArbDraw/bridge.log"),
            )
            self.assertEqual(
                default_lock_path(),
                Path("/Users/tester/Library/Application Support/ArbDraw/menu-bar.lock"),
            )
        self.assertEqual(bridge_launcher_name("darwin"), "arbdraw-bridge")
        self.assertEqual(bridge_launcher_name("win32"), "arbdraw-bridge.exe")


if __name__ == "__main__":
    unittest.main()
