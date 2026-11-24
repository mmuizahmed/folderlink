//go:build !windows

package service

// ToastShortcutExists is Windows-only: toasts do not exist on other
// platforms in this build.
func ToastShortcutExists() bool { return false }

// EnsureToastShortcut is Windows-only.
func EnsureToastShortcut() error { return nil }
