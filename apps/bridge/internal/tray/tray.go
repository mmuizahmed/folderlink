// Package tray shows FolderLink in the system tray (Windows) or menu bar
// (macOS) / tray (Linux), with a small menu: connection status, dashboard
// links, restart, quit.
//
// The tray is only in Windows builds. systray needs cgo on macOS
// (Objective-C) and Linux (libayatana-appindicator headers), but release
// binaries are built with CGO_ENABLED=0, so those platforms get the stub in
// tray_stub.go and the bridge runs headless. On Windows systray is pure Go
// syscalls, so the tray is in every Windows build. To enable it on
// macOS/Linux, build with CGO_ENABLED=1 and change the build tag on
// tray_systray.go to `windows || cgo` (Linux also needs
// libayatana-appindicator3-dev installed).
package tray

import (
	"sync"

	"github.com/mmuizahmed/folderlink/apps/bridge/internal/client"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/mode"
)

// Options controls the tray menu.
type Options struct {
	// Web is the dashboard base URL, e.g. https://folderlink.muiz.pk.
	Web string
	// OnRestart is called when the user picks Restart bridge.
	OnRestart func()
	// OnQuit is called when the user picks Quit FolderLink.
	OnQuit func()
	// OnCheckUpdates is called when the user picks Check for updates.
	OnCheckUpdates func()
	// NotifySuccess is the initial state of the "Notify on successful
	// reads" checkbox. Off by default: reads are frequent.
	NotifySuccess bool
	// OnToggleNotifySuccess is called when the user toggles the
	// "Notify on successful reads" checkbox, with the new state.
	OnToggleNotifySuccess func(bool)
	// OnReady is called when the tray menu is created and the icon is up.
	// It is how the bridge shows a startup toast after a shortcut launch.
	OnReady func()
	// Mode is the write approval mode shown in the menu at startup.
	// An unknown value shows as manual: fail closed.
	Mode mode.Mode
}

var (
	mu            sync.Mutex
	state         = client.StateConnecting
	statusItem    statusTitleSetter // set in onReady; nil until then
	updateItem    updateTitleSetter // set in onReady; nil until then
	notifyItem    notifyCheckSetter // set in onReady; nil until then
	notifySuccess bool
	modeItem      statusTitleSetter // set in onReady; nil until then
	currentMode   = mode.ModeManual
)

// modeTitle is the menu line for a write approval mode.
func modeTitle(m mode.Mode) string {
	return "Write approval: " + m.Label()
}

// SetMode updates the mode line. It is safe to call before Run and from
// any goroutine; the latest mode is applied when the menu is created.
func SetMode(m mode.Mode) {
	mu.Lock()
	currentMode = m
	item := modeItem
	mu.Unlock()
	if item != nil {
		item.SetTitle(modeTitle(m))
	}
}

func currentModeValue() mode.Mode {
	mu.Lock()
	defer mu.Unlock()
	return currentMode
}

// notifyCheckSetter is the checkbox menu item for success notifications.
// It is an interface so this file does not depend on the systray package.
type notifyCheckSetter interface {
	Check()
	Uncheck()
}

// SetNotifySuccess updates the checkbox state. It is safe to call before
// Run and from any goroutine.
func SetNotifySuccess(on bool) {
	mu.Lock()
	notifySuccess = on
	item := notifyItem
	mu.Unlock()
	if item == nil {
		return
	}
	if on {
		item.Check()
	} else {
		item.Uncheck()
	}
}

func currentNotifySuccess() bool {
	mu.Lock()
	defer mu.Unlock()
	return notifySuccess
}

// updateTitleSetter is the menu item for checking for updates. It is an
// interface so this file does not depend on the systray package.
type updateTitleSetter interface {
	SetTitle(string)
}

// SetUpdateAvailable changes the update menu item to offer the new
// version. It is safe to call before Run and from any goroutine; pass an
// empty tag to reset it to "Check for updates".
func SetUpdateAvailable(tag string) {
	mu.Lock()
	item := updateItem
	mu.Unlock()
	if item == nil {
		return
	}
	if tag == "" {
		item.SetTitle("Check for updates")
		return
	}
	item.SetTitle("Update to FolderLink " + tag)
}

// statusTitleSetter is the menu item showing the connection state. It is an
// interface so this file does not depend on the systray package.
type statusTitleSetter interface {
	SetTitle(string)
}

// statusTitle is the menu line for a connection state.
func statusTitle(s client.State) string {
	switch s {
	case client.StateConnected:
		return "● Connected"
	case client.StateOffline:
		return "○ Offline — retrying"
	default:
		return "◐ Connecting…"
	}
}

// SetState updates the status line. It is safe to call before Run and from
// any goroutine; the latest state is applied when the menu is created.
func SetState(s client.State) {
	mu.Lock()
	state = s
	item := statusItem
	mu.Unlock()
	if item != nil {
		item.SetTitle(statusTitle(s))
	}
}

func currentState() client.State {
	mu.Lock()
	defer mu.Unlock()
	return state
}
