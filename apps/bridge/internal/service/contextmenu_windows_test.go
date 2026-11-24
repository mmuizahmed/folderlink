//go:build windows

package service

import (
	"os"
	"path/filepath"
	"testing"
)

func TestContextMenuCommand(t *testing.T) {
	exe := `C:\Users\muiz\AppData\Local\FolderLink\folderlink.exe`
	want := `"C:\Users\muiz\AppData\Local\FolderLink\folderlink.exe" allow "%1"`
	if got := contextMenuCommand(exe); got != want {
		t.Fatalf("contextMenuCommand(%q) = %q, want %q", exe, got, want)
	}
}

func TestResolveMenuIcon(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "folderlink.exe")
	icon := []byte{0x00, 0x00, 0x01, 0x00}
	// With icon bytes, the verb points at the written .ico file.
	got := resolveMenuIcon(dir, exe, icon)
	if got != filepath.Join(dir, "icon.ico") {
		t.Fatalf("resolveMenuIcon with icon = %q, want icon.ico in %q", got, dir)
	}
	if _, err := os.ReadFile(got); err != nil {
		t.Fatalf("resolveMenuIcon did not write the icon: %v", err)
	}
	// Without icon bytes, the verb falls back to the exe path.
	if got := resolveMenuIcon(dir, exe, nil); got != exe {
		t.Fatalf("resolveMenuIcon without icon = %q, want %q", got, exe)
	}
	// A write failure also falls back to the exe path.
	if got := resolveMenuIcon(filepath.Join(dir, "no-such-dir"), exe, icon); got != exe {
		t.Fatalf("resolveMenuIcon on write failure = %q, want %q", got, exe)
	}
}
