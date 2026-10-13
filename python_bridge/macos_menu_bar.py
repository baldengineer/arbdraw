"""Native macOS menu bar controller for the ArbDraw Python bridge."""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from .tray_controller import DEFAULT_BRIDGE_URL, BridgeController, BridgeState


@dataclass(frozen=True)
class MenuState:
    """Platform-neutral values rendered by the AppKit menu."""

    status: str
    detail: str
    version: str
    adapters: tuple[str, ...]
    can_start: bool
    can_stop: bool
    can_restart: bool
    running: bool


def menu_state(controller: BridgeController) -> MenuState:
    """Return a testable snapshot of the current menu contents and controls."""

    return MenuState(
        status=controller.status_text,
        detail=controller.detail,
        version=controller.version,
        adapters=controller.adapters,
        can_start=controller.can_start,
        can_stop=controller.can_stop,
        can_restart=controller.can_restart,
        running=controller.state in (BridgeState.RUNNING, BridgeState.RUNNING_EXTERNAL),
    )


def default_lock_path() -> Path:
    return Path.home() / "Library" / "Application Support" / "ArbDraw" / "menu-bar.lock"


class SingleInstanceLock:
    """Advisory process lock retained for the lifetime of the menu bar app."""

    def __init__(self, stream):
        self._stream = stream

    def release(self) -> None:
        if self._stream is None:
            return
        import fcntl

        fcntl.flock(self._stream.fileno(), fcntl.LOCK_UN)
        self._stream.close()
        self._stream = None


def acquire_single_instance_lock(path: Path | None = None) -> SingleInstanceLock | None:
    """Acquire the per-user app lock, returning ``None`` for a second instance."""

    import fcntl

    lock_path = path or default_lock_path()
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    stream = lock_path.open("a+", encoding="utf-8")
    try:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        stream.close()
        return None
    stream.seek(0)
    stream.truncate()
    stream.write(str(os.getpid()))
    stream.flush()
    return SingleInstanceLock(stream)


def run_menu_bar(controller: BridgeController) -> int:
    """Run the native AppKit status item and application event loop."""

    if sys.platform != "darwin":
        raise RuntimeError("The ArbDraw menu bar app is available only on macOS.")

    try:
        import objc
        from AppKit import (
            NSAlert,
            NSApplication,
            NSApplicationActivationPolicyAccessory,
            NSColor,
            NSImage,
            NSMenu,
            NSMenuItem,
            NSStatusBar,
            NSVariableStatusItemLength,
            NSWorkspace,
        )
        from Foundation import NSObject, NSTimer, NSURL
    except ImportError as error:
        raise RuntimeError(
            "The macOS menu bar app requires PyObjC. Reinstall ArbDraw on macOS "
            "so the pyobjc-framework-Cocoa dependency is included."
        ) from error

    instance_lock = acquire_single_instance_lock()
    if instance_lock is None:
        application = NSApplication.sharedApplication()
        application.setActivationPolicy_(NSApplicationActivationPolicyAccessory)
        alert = NSAlert.alloc().init()
        alert.setMessageText_("ArbDraw Bridge is already in the menu bar.")
        alert.setInformativeText_("Use the existing ArbDraw status item to manage the bridge.")
        alert.runModal()
        return 0

    class MenuBarDelegate(NSObject):
        def initWithController_lock_(self, bridge_controller, app_lock):
            self = objc.super(MenuBarDelegate, self).init()
            if self is not None:
                self.controller = bridge_controller
                self.instance_lock = app_lock
                self.status_item = None
                self.timer = None
            return self

        @objc.python_method
        def add_item(self, menu, title, action=None, enabled=True):
            item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
                title, action, ""
            )
            if action is not None:
                item.setTarget_(self)
            item.setEnabled_(enabled)
            menu.addItem_(item)
            return item

        @objc.python_method
        def update_menu(self):
            snapshot = menu_state(self.controller)
            menu = NSMenu.alloc().initWithTitle_("ArbDraw Bridge")
            self.add_item(menu, f"Status: {snapshot.status}", enabled=False)
            self.add_item(menu, snapshot.detail, enabled=False)
            self.add_item(menu, f"Version: {snapshot.version}", enabled=False)
            self.add_item(menu, "Available adapters:", enabled=False)
            if snapshot.adapters:
                for adapter in snapshot.adapters:
                    self.add_item(menu, f"  {adapter}", enabled=False)
            else:
                self.add_item(menu, "  None detected", enabled=False)
            menu.addItem_(NSMenuItem.separatorItem())
            self.add_item(menu, "Start Bridge", "startBridge:", snapshot.can_start)
            self.add_item(menu, "Stop Bridge", "stopBridge:", snapshot.can_stop)
            self.add_item(menu, "Restart Bridge", "restartBridge:", snapshot.can_restart)
            self.add_item(
                menu,
                "Open Bridge Log",
                "openLog:",
                self.controller.log_path.is_file(),
            )
            menu.addItem_(NSMenuItem.separatorItem())
            self.add_item(menu, "Quit ArbDraw Bridge", "quitApp:")
            self.status_item.setMenu_(menu)

            button = self.status_item.button()
            button.setToolTip_(
                f"ArbDraw Bridge {snapshot.version} — {snapshot.status}"
            )
            if hasattr(button, "setContentTintColor_"):
                color = (
                    NSColor.systemBlueColor()
                    if snapshot.running
                    else NSColor.secondaryLabelColor()
                )
                button.setContentTintColor_(color)

        @objc.python_method
        def run_command(self, command):
            command()
            self.update_menu()

        def applicationDidFinishLaunching_(self, notification):
            self.status_item = NSStatusBar.systemStatusBar().statusItemWithLength_(
                NSVariableStatusItemLength
            )
            button = self.status_item.button()
            image = None
            if hasattr(NSImage, "imageWithSystemSymbolName_accessibilityDescription_"):
                image = NSImage.imageWithSystemSymbolName_accessibilityDescription_(
                    "waveform.path.ecg", "ArbDraw Bridge"
                )
            if image is not None:
                image.setTemplate_(True)
                button.setImage_(image)
            else:
                button.setTitle_("AD")

            self.controller.start()
            self.update_menu()
            self.timer = NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
                1.0, self, "refreshStatus:", None, True
            )

        def applicationWillTerminate_(self, notification):
            if self.timer is not None:
                self.timer.invalidate()
            self.controller.close()
            self.instance_lock.release()

        def refreshStatus_(self, timer):
            self.controller.refresh()
            self.update_menu()

        def startBridge_(self, sender):
            self.run_command(self.controller.start)

        def stopBridge_(self, sender):
            self.run_command(self.controller.stop)

        def restartBridge_(self, sender):
            self.run_command(self.controller.restart)

        def openLog_(self, sender):
            url = NSURL.fileURLWithPath_(str(self.controller.log_path))
            NSWorkspace.sharedWorkspace().openURL_(url)

        def quitApp_(self, sender):
            NSApplication.sharedApplication().terminate_(sender)

    application = NSApplication.sharedApplication()
    application.setActivationPolicy_(NSApplicationActivationPolicyAccessory)
    delegate = MenuBarDelegate.alloc().initWithController_lock_(controller, instance_lock)
    application.setDelegate_(delegate)
    try:
        application.run()
    finally:
        # AppKit normally calls applicationWillTerminate_. Release explicitly if
        # startup fails before that callback is delivered.
        if instance_lock._stream is not None:
            controller.close()
            instance_lock.release()
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Control the ArbDraw Python bridge from the macOS menu bar."
    )
    parser.add_argument("--bridge", help="Path or command name for arbdraw-bridge.")
    parser.add_argument(
        "--url", default=DEFAULT_BRIDGE_URL, help="Bridge base URL used for status checks."
    )
    parser.add_argument(
        "bridge_args", nargs=argparse.REMAINDER, help="Arguments after -- are passed to the bridge."
    )
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
        raise SystemExit(run_menu_bar(controller))
    except Exception as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
