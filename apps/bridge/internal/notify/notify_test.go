package notify

import "testing"

func TestNotifierOptIn(t *testing.T) {
	n := New(true, false)
	if n.NotifySuccess() {
		t.Fatal("NotifySuccess() = true, want false by default")
	}
	n.SetNotifySuccess(true)
	if !n.NotifySuccess() {
		t.Fatal("NotifySuccess() = false after SetNotifySuccess(true)")
	}
	// These must not panic. On Linux show is a no-op; on Windows they
	// would toast, throttled to one refused per 10s and one success
	// per minute.
	n.Refused("notes", ".env")
	n.Success("notes", "readme.md")
}

func TestNilNotifierIsSafe(t *testing.T) {
	var n *Notifier
	n.Refused("notes", ".env")
	n.Success("notes", "readme.md")
	n.WriteDone("notes", "a.md")
	n.WriteRefused("notes", ".env")
	n.ApprovalNeeded("notes", "run.ps1", "some-id")
	n.CommandStarted("notes", []string{"git", "status"})
	n.SetNotifySuccess(true)
}

func TestWriteNotifiersDoNotPanic(t *testing.T) {
	n := New(true, false)
	n.WriteDone("notes", "a.md")
	n.WriteRefused("notes", ".env")
	n.ApprovalNeeded("notes", "run.ps1", "some-id")
	n.CommandStarted("notes", []string{"git", "status"})
	// A second call within the throttle window stays quiet but must not panic.
	n.WriteDone("notes", "b.md")
	n.ApprovalNeeded("notes", "x.sh", "other-id")
}

func TestDisabledNotifier(t *testing.T) {
	n := New(false, true)
	// Disabled: no toasts even for refusals. Still must not panic.
	n.Refused("notes", ".env")
	n.Success("notes", "readme.md")
}
