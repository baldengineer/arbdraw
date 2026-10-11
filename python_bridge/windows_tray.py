"""Windows notification-area controller for ``arbdraw-bridge.exe``.

The package installs this module as the windowed ``arbdraw-bridge-tray.exe``
entry point.  Win32 is accessed through ctypes so the controller does not add a
desktop-framework dependency to the bridge.
"""

from __future__ import annotations

import argparse
import ctypes
import importlib.resources
import sys

from .tray_controller import (
    DEFAULT_BRIDGE_URL,
    BridgeController,
    BridgeState,
    HealthInfo,
    default_log_path,
    find_bridge_executable,
    probe_bridge,
)


def tray_icon_resource_name(state: BridgeState) -> str:
    """Use brand blue only while a bridge is confirmed to be running."""

    return (
        "ArbDraw.ico"
        if state in (BridgeState.RUNNING, BridgeState.RUNNING_EXTERNAL)
        else "ArbDraw-gray.ico"
    )


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
    IDI_APPLICATION = 32512
    IMAGE_ICON = 1
    LR_DEFAULTSIZE, LR_LOADFROMFILE = 0x40, 0x10
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
    user32.LoadImageW.argtypes = [
        wintypes.HINSTANCE,
        wintypes.LPCWSTR,
        wintypes.UINT,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.UINT,
    ]
    user32.LoadImageW.restype = wintypes.HANDLE
    user32.DestroyIcon.argtypes = [wintypes.HICON]
    user32.DestroyIcon.restype = wintypes.BOOL
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

    def load_brand_icon(resource_name: str):
        resource = importlib.resources.files("python_bridge").joinpath(resource_name)
        with importlib.resources.as_file(resource) as icon_path:
            icon = user32.LoadImageW(
                None,
                str(icon_path),
                IMAGE_ICON,
                0,
                0,
                LR_DEFAULTSIZE | LR_LOADFROMFILE,
            )
        return (icon, True) if icon else (user32.LoadIconW(None, IDI_APPLICATION), False)

    blue_icon, blue_icon_owned = load_brand_icon("ArbDraw.ico")
    gray_icon, gray_icon_owned = load_brand_icon("ArbDraw-gray.ico")

    def icon_for_state(state: BridgeState):
        return blue_icon if tray_icon_resource_name(state) == "ArbDraw.ico" else gray_icon

    def update_icon(balloon: bool = False) -> None:
        notify_data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
        notify_data.hIcon = icon_for_state(controller.state)
        notify_data.szTip = (
            f"ArbDraw Bridge {controller.version} — {controller.status_text}"[:127]
        )
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
            user32.AppendMenuW(menu, MF_STRING | MF_GRAYED, 0, f"Version: {controller.version}")
            user32.AppendMenuW(menu, MF_STRING | MF_GRAYED, 0, "Available adapters:")
            if controller.adapters:
                for adapter in controller.adapters:
                    user32.AppendMenuW(menu, MF_STRING | MF_GRAYED, 0, f"  {adapter}")
            else:
                user32.AppendMenuW(menu, MF_STRING | MF_GRAYED, 0, "  None detected")
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
                if blue_icon_owned:
                    user32.DestroyIcon(blue_icon)
                if gray_icon_owned:
                    user32.DestroyIcon(gray_icon)
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
    window_class.hIcon = blue_icon
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
    notify_data.szTip = (
        f"ArbDraw Bridge {controller.version} — {controller.status_text}"[:127]
    )
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
