//go:build windows

package tray

import (
	"context"
	_ "embed"
	"encoding/base64"
	"log/slog"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/getlantern/systray"

	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/browser"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/mode"
)

// The tray icons are stored as base64 text, not binaries: the GitHub push
// route only accepts UTF-8 files, so the .ico/.png live here as .b64 and
// are decoded at startup. Same bytes, same tray icon.
//
//go:embed icon.ico.b64
var iconICOBase64 string

//go:embed icon.png.b64
var iconPNGBase64 string

var iconICO, iconPNG []byte

func init() {
	iconICO = decodeIcon(iconICOBase64)
	iconPNG = decodeIcon(iconPNGBase64)
}

// decodeIcon turns a base64 icon back into bytes. A corrupt icon logs and
// yields nil (the tray runs without an icon) instead of crashing the bridge.
func decodeIcon(b64 string) []byte {
	b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b64))
	if err != nil {
		slog.Warn("tray icon did not decode", "err", err.Error())
		return nil
	}
	return b
}

// IconICO returns the decoded .ico bytes for the FolderLink mark, or nil
// when the icon did not decode. Other packages use it for places that need
// the mark as a file — the Explorer context menu points at a real .ico on
// disk, which the installer writes from these bytes.
func IconICO() []byte {
	return iconICO
}

// Run starts the system tray on the main goroutine and blocks until the user
// quits or ctx ends. It must be called from the main goroutine: on macOS the
// tray needs the main thread, and on Windows the message loop lives here.
// If the tray cannot start, Run recovers, logs, and returns so the bridge
// keeps running headless instead of dying with it.
func Run(ctx context.Context, opts Options) {
	defer func() {
		if rec := recover(); rec != nil {
			slog.Error("system tray failed", "err", rec)
		}
	}()
	// The startup mode is only the local cache: apply it now, before the
	// menu exists, so a live mode that arrives later (hello sync or a
	// settings push) wins over it.
	if m, ok := mode.Parse(string(opts.Mode)); ok {
		mu.Lock()
		currentMode = m
		mu.Unlock()
	}
	go func() {
		<-ctx.Done()
		systray.Quit()
	}()
	// The logon task can fire before Explorer is up. Wait for the shell
	// so the tray icon is created once the notification area exists;
	// otherwise Shell_NotifyIcon fails silently, the icon is never
	// created, and the bridge runs headless with no tray icon even though
	// the process is alive. The bridge itself already runs in its own
	// goroutine, so waiting here only delays the tray, not the connection.
	if !waitForShell(ctx, 60*time.Second) {
		slog.Warn("system tray: shell not ready after 60s, starting tray anyway")
	}
	systray.Run(func() { onReady(opts) }, func() {})
}

// waitForShell waits until the Windows shell (Explorer taskbar) exists,
// returning true when it is up, false on timeout or ctx done. It polls
// FindWindow for the Shell_TrayWnd class, which Explorer creates when the
// taskbar — and with it the notification area — is ready.
func waitForShell(ctx context.Context, timeout time.Duration) bool {
	if shellWindowExists() {
		return true
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return false
		case <-timer.C:
			return false
		case <-ticker.C:
			if shellWindowExists() {
				return true
			}
		}
	}
}

var (
	modUser32       = syscall.NewLazyDLL("user32.dll")
	procFindWindowW = modUser32.NewProc("FindWindowW")
)

// shellWindowExists reports whether the Explorer taskbar window exists.
// A zero return means no window of that class (shell not up yet) or the
// lookup failed; either way the caller treats it as "not ready".
func shellWindowExists() bool {
	className, err := syscall.UTF16PtrFromString("Shell_TrayWnd")
	if err != nil {
		return false
	}
	ret, _, _ := procFindWindowW.Call(uintptr(unsafe.Pointer(className)), 0)
	return ret != 0
}

// Quit stops the tray loop, so Run returns. It is how an update apply
// exits the process after handing the binary swap to the helper.
func Quit() {
	systray.Quit()
}

func onReady(opts Options) {
	// .ico on Windows; the PNG is for macOS/Linux when this file is ever
	// built for them with cgo (see tray.go).
	systray.SetIcon(iconICO)
	systray.SetTooltip("FolderLink")
	item := systray.AddMenuItem(statusTitle(currentState()), "Connection to FolderLink")
	item.Disable()
	// The write approval mode is a display line, not a control: the mode
	// is changed in the dashboard Settings, and the tray shows it. There
	// is no approve-from-tray UI in this build: approving happens in the
	// dashboard, and the tray notification is the alert.
	modeLine := systray.AddMenuItem(modeTitle(currentModeValue()), "How writes are approved; change it in Settings")
	modeLine.Disable()
	mu.Lock()
	statusItem = item
	modeItem = modeLine
	mu.Unlock()
	systray.AddSeparator()
	// Both open the dashboard: the approved folders are managed there.
	dash := systray.AddMenuItem("Open dashboard", "Open the FolderLink dashboard")
	folders := systray.AddMenuItem("Approved folders", "See the folders this computer shares")
	systray.AddSeparator()
	restart := systray.AddMenuItem("Restart bridge", "Drop the connection and reconnect")
	update := systray.AddMenuItem("Check for updates", "Check GitHub for a newer FolderLink")
	notify := systray.AddMenuItem("Notify on successful reads", "Show a toast when an app reads a file")
	quit := systray.AddMenuItem("Quit FolderLink", "Stop the bridge and remove the tray icon")
	mu.Lock()
	updateItem = update
	notifyItem = notify
	notifySuccess = opts.NotifySuccess
	mu.Unlock()
	if opts.NotifySuccess {
		notify.Check()
	}
	go watchClicks(dash, func() { _ = browser.Open(opts.Web + "/dashboard") })
	go watchClicks(folders, func() { _ = browser.Open(opts.Web + "/dashboard") })
	go watchClicks(restart, opts.OnRestart)
	go watchClicks(update, opts.OnCheckUpdates)
	go watchClicks(notify, func() {
		on := !currentNotifySuccess()
		if opts.OnToggleNotifySuccess != nil {
			opts.OnToggleNotifySuccess(on)
			return
		}
		SetNotifySuccess(on)
	})
	go watchClicks(quit, func() {
		if opts.OnQuit != nil {
			opts.OnQuit()
		}
		systray.Quit()
	})
}

func watchClicks(item *systray.MenuItem, fn func()) {
	for range item.ClickedCh {
		if fn != nil {
			fn()
		}
	}
}
