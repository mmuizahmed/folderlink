package service

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMenuIconPath(t *testing.T) {
	dir := filepath.Join("C:", "Users", "muiz", "AppData", "Local", "FolderLink")
	want := filepath.Join(dir, "icon.ico")
	if got := menuIconPath(dir); got != want {
		t.Fatalf("menuIconPath(%q) = %q, want %q", dir, got, want)
	}
}

func TestWriteMenuIcon(t *testing.T) {
	dir := t.TempDir()
	icon := []byte{0x00, 0x00, 0x01, 0x00, 0x01, 0x02}
	path, err := writeMenuIcon(dir, icon)
	if err != nil {
		t.Fatalf("writeMenuIcon: %v", err)
	}
	if path != filepath.Join(dir, "icon.ico") {
		t.Fatalf("writeMenuIcon path = %q, want icon.ico in %q", path, dir)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading written icon: %v", err)
	}
	if string(got) != string(icon) {
		t.Fatalf("written icon = %v, want %v", got, icon)
	}
	// Re-install overwrites rather than failing on an existing file.
	path2, err := writeMenuIcon(dir, []byte{0x09})
	if err != nil {
		t.Fatalf("writeMenuIcon again: %v", err)
	}
	if path2 != path {
		t.Fatalf("writeMenuIcon again path = %q, want %q", path2, path)
	}
	got, err = os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading rewritten icon: %v", err)
	}
	if len(got) != 1 || got[0] != 0x09 {
		t.Fatalf("rewritten icon = %v, want [9]", got)
	}
}

func TestWriteMenuIconMissingDir(t *testing.T) {
	if _, err := writeMenuIcon(filepath.Join(t.TempDir(), "no-such-dir"), []byte{0x00}); err == nil {
		t.Fatal("writeMenuIcon into a missing directory must fail")
	}
}
