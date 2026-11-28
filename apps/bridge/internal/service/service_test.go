package service

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInstallDirFor(t *testing.T) {
	winHome := `C:\Users\muiz`
	winBase := `C:\Users\muiz\AppData\Local`
	cases := []struct {
		goos, localAppData, home string
		want                     string
		wantErr                  bool
	}{
		{"windows", winBase, winHome, filepath.Join(winBase, "FolderLink"), false},
		{"windows", "", winHome, filepath.Join(filepath.Join(winHome, "AppData", "Local"), "FolderLink"), false},
		{"windows", winBase, "", "", true},
		{"darwin", "", "/Users/muiz", "/Users/muiz/.local/share/folderlink", false},
		{"linux", "", "/home/muiz", "/home/muiz/.local/share/folderlink", false},
		{"linux", "", "", "", true},
		{"plan9", "", "/home/muiz", "", true},
	}
	for _, tc := range cases {
		got, err := installDirFor(tc.goos, tc.localAppData, tc.home)
		if tc.wantErr {
			if err == nil {
				t.Errorf("installDirFor(%q, %q, %q) = %q, want error", tc.goos, tc.localAppData, tc.home, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("installDirFor(%q, %q, %q) error: %v", tc.goos, tc.localAppData, tc.home, err)
			continue
		}
		if got != tc.want {
			t.Errorf("installDirFor(%q, %q, %q) = %q, want %q", tc.goos, tc.localAppData, tc.home, got, tc.want)
		}
	}
}

func TestDesktopShortcutPathFor(t *testing.T) {
	got := desktopShortcutPathFor("/home/muiz")
	want := filepath.Join("/home/muiz", "Desktop", "FolderLink.lnk")
	if got != want {
		t.Errorf("desktopShortcutPathFor(%q) = %q, want %q", "/home/muiz", got, want)
	}
}

func TestIsAlreadyRunning(t *testing.T) {
	if IsAlreadyRunning(nil) {
		t.Errorf("IsAlreadyRunning(nil) = true, want false")
	}
	if !IsAlreadyRunning(errAlreadyRunning) {
		t.Errorf("IsAlreadyRunning(%q) = false, want true", errAlreadyRunning)
	}
	if IsAlreadyRunning(errOther) {
		t.Errorf("IsAlreadyRunning(%q) = true, want false", errOther)
	}
}

var (
	errAlreadyRunning = errors.New("schtasks: ERROR: The task is already running.")
	errOther          = errors.New("schtasks: ERROR: The system cannot find the file specified.")
)

func TestTryAcquireSingleInstance(t *testing.T) {
	release, alreadyRunning, err := TryAcquireSingleInstance()
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	// On Linux the stub reports no other bridge; on Windows a second
	// acquire in the same process would report already running, so this
	// only asserts the call itself works and the release does not panic.
	_ = alreadyRunning
}

func TestSameFile(t *testing.T) {
	if !sameFile("/a/b/folderlink", "/a/b/folderlink") {
		t.Errorf("sameFile(identical) = false")
	}
	if sameFile("/a/b/folderlink", "/a/c/folderlink") {
		t.Errorf("sameFile(different dir) = true")
	}
	if sameFile("/a/b/../b/folderlink", "/a/b/folderlink") {
		// Clean resolves the .., so these are the same path.
	} else {
		t.Errorf("sameFile(cleaned) = false")
	}
}

func TestCopyFile(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.exe")
	if err := os.WriteFile(src, []byte("fake binary"), 0o600); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "dst.exe")
	got, err := copyFile(src, dst)
	if err != nil {
		t.Fatal(err)
	}
	if got != dst {
		t.Fatalf("copyFile() = %q, want %q", got, dst)
	}
	data, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "fake binary" {
		t.Fatalf("copied content = %q, want %q", data, "fake binary")
	}
	if _, err := os.Stat(dst + ".new"); !os.IsNotExist(err) {
		t.Fatalf("temp file %q was left behind", dst+".new")
	}
	if _, err := copyFile(filepath.Join(dir, "missing"), dst); err == nil {
		t.Fatalf("copyFile(missing) = nil, want error")
	}
}

func TestStageBinary(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	// stageBinary copies the running test binary; that is the point — the
	// copy must land in the install dir and be executable.
	target, err := stageBinary()
	if err != nil {
		t.Fatal(err)
	}
	dir, err := InstallDir()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(target, dir) {
		t.Fatalf("stageBinary() = %q, want it under %q", target, dir)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&0o111 == 0 {
		t.Fatalf("staged copy %q is not executable", target)
	}
}
