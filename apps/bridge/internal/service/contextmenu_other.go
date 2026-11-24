//go:build !windows

package service

// RegisterContextMenu is Windows-only: other platforms have no Explorer
// context menu to register.
func RegisterContextMenu() error { return nil }

// RemoveContextMenu is Windows-only.
func RemoveContextMenu() error { return nil }

// ContextMenuRegistered is Windows-only.
func ContextMenuRegistered() bool { return false }
