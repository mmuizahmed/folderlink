// Package notify shows Windows toast notifications for file reads.
//
// A refused read always notifies: an app asking for a secret or a path
// outside the folder is the one event the user must see. A successful read
// notifies only when the user opts in (NotifySuccess), because reads are
// frequent and a toast per read is spam. Both kinds are throttled, so a
// runaway app cannot flood the desktop: at most one refused toast every
// 10 seconds, one success toast every minute.
//
// Notifications are Windows-only. On macOS and Linux the notifier is a
// no-op (notify_other.go), so the bridge builds and runs the same
// everywhere. On Windows the backend is github.com/gen2brain/beeep, which
// uses the WinRT toast API in-process (no CGO, no PowerShell child) and
// falls back to PowerShell if WinRT is unavailable.
//
// A toast only appears if Windows knows the app: the process must carry
// the AppUserModelID "Muiz.FolderLink" (EnsureAppIdentity, called at
// background startup) and a Start Menu shortcut with the same ID must
// exist (created by `folderlink install`, see service.EnsureToastShortcut).
// Without the shortcut, Windows silently drops the toast and beeep still
// reports success — there is no way to detect that from here, which is
// why `folderlink doctor` checks the shortcut.
package notify

import (
	_ "embed"
	"sync"
	"time"
)

// AppID is the Windows AppUserModelID. It must match the Start Menu
// shortcut created by `folderlink install` and the ID set on the process
// at startup. Picked once; never change it, or existing installs stop
// showing toasts.
const AppID = "Muiz.FolderLink"

const (
	refusedThrottle = 10 * time.Second
	successThrottle = time.Minute
)

// Notifier sends toasts. The zero value is disabled.
type Notifier struct {
	mu            sync.Mutex
	enabled       bool
	notifySuccess bool
	lastRefused   time.Time
	lastSuccess   time.Time
	lastWrite     time.Time
	lastApproval  time.Time
	lastCommand   time.Time
}

// New returns a notifier. Enabled false means no toasts at all (console
// runs); notifySuccess opts into toasts for successful reads.
func New(enabled, notifySuccess bool) *Notifier {
	return &Notifier{enabled: enabled, notifySuccess: notifySuccess}
}

// SetNotifySuccess turns success toasts on or off at runtime (the tray
// menu toggles it). Safe on a nil receiver.
func (n *Notifier) SetNotifySuccess(on bool) {
	if n == nil {
		return
	}
	n.mu.Lock()
	n.notifySuccess = on
	n.mu.Unlock()
}

// NotifySuccess reports whether success toasts are on. Safe on a nil
// receiver (a nil notifier never toasts).
func (n *Notifier) NotifySuccess() bool {
	if n == nil {
		return false
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.notifySuccess
}

// Refused tells the user an app's read was refused. It never blocks the
// caller: the toast is sent from a goroutine.
func (n *Notifier) Refused(folder, path string) {
	if n == nil || !n.isEnabled() {
		return
	}
	n.mu.Lock()
	if time.Since(n.lastRefused) < refusedThrottle {
		n.mu.Unlock()
		return
	}
	n.lastRefused = time.Now()
	n.mu.Unlock()
	title := "FolderLink — read refused"
	body := "An app tried to read " + displayPath(folder, path) + ", and FolderLink refused it."
	go show(title, body)
}

// Success tells the user an app read a file, when the user opted in. It
// never blocks the caller.
func (n *Notifier) Success(folder, path string) {
	if n == nil || !n.isEnabled() {
		return
	}
	n.mu.Lock()
	if !n.notifySuccess || time.Since(n.lastSuccess) < successThrottle {
		n.mu.Unlock()
		return
	}
	n.lastSuccess = time.Now()
	n.mu.Unlock()
	go show("FolderLink — file read", "An app read "+displayPath(folder, path)+".")
}

// WriteDone tells the user an app wrote or deleted a file. It is always
// shown: a file changing is the event to see. It never blocks the caller.
func (n *Notifier) WriteDone(folder, path string) {
	if n == nil || !n.isEnabled() {
		return
	}
	if !n.allow(&n.lastWrite, refusedThrottle) {
		return
	}
	go show("FolderLink — file changed", "An app changed "+displayPath(folder, path)+".")
}

// WriteRefused tells the user an app's write or delete was refused. It
// never blocks the caller.
func (n *Notifier) WriteRefused(folder, path string) {
	if n == nil || !n.isEnabled() {
		return
	}
	if !n.allow(&n.lastWrite, refusedThrottle) {
		return
	}
	go show("FolderLink — change refused", "An app tried to change "+displayPath(folder, path)+", and FolderLink refused it.")
}

// ApprovalNeeded tells the user an app asked for a dashboard approval.
// It never blocks the caller.
func (n *Notifier) ApprovalNeeded(folder, path, requestID string) {
	if n == nil || !n.isEnabled() {
		return
	}
	if !n.allow(&n.lastApproval, refusedThrottle) {
		return
	}
	body := "An app asked to change " + displayPath(folder, path) + ". Open the FolderLink dashboard to review it."
	if requestID != "" {
		body += " (Request " + requestID + ")"
	}
	go show("FolderLink — approval needed", body)
}

// CommandStarted tells the user an approved command started running. It
// never blocks the caller.
func (n *Notifier) CommandStarted(folder string, argv []string) {
	if n == nil || !n.isEnabled() {
		return
	}
	if !n.allow(&n.lastCommand, refusedThrottle) {
		return
	}
	cmd := ""
	if len(argv) > 0 {
		cmd = argv[0]
	}
	go show("FolderLink — command started", "An app started "+cmd+" in "+folder+".")
}

// allow rate-limits one toast kind: at most one per interval. It returns
// false when the caller should stay quiet.
func (n *Notifier) allow(last *time.Time, interval time.Duration) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	if time.Since(*last) < interval {
		return false
	}
	*last = time.Now()
	return true
}

func (n *Notifier) isEnabled() bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.enabled
}

func displayPath(folder, path string) string {
	if path == "" {
		return folder
	}
	if folder == "" {
		return path
	}
	return folder + "/" + path
}
