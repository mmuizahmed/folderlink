//go:build windows

package service

import "testing"

func TestContextMenuCommand(t *testing.T) {
	exe := `C:\Users\muiz\AppData\Local\FolderLink\folderlink.exe`
	want := `"C:\Users\muiz\AppData\Local\FolderLink\folderlink.exe" allow "%1"`
	if got := contextMenuCommand(exe); got != want {
		t.Fatalf("contextMenuCommand(%q) = %q, want %q", exe, got, want)
	}
}
