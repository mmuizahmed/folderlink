//go:build !windows

package notify

// show is a no-op without a Windows desktop to toast on.
func show(title, body string) {}

// EnsureAppIdentity is a no-op without a Windows desktop.
func EnsureAppIdentity() {}
