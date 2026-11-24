package config

import (
	"os"
	"testing"
)

func TestAutoUpdateEnabled(t *testing.T) {
	t.Setenv("FOLDERLINK_AUTO_UPDATE", "")
	if got := (File{}).AutoUpdateEnabled(); !got {
		t.Errorf("empty config: AutoUpdateEnabled = false, want true (default on)")
	}
	off := false
	if got := (File{AutoUpdate: &off}).AutoUpdateEnabled(); got {
		t.Errorf("AutoUpdate=false: AutoUpdateEnabled = true, want false")
	}
	on := true
	if got := (File{AutoUpdate: &on}).AutoUpdateEnabled(); !got {
		t.Errorf("AutoUpdate=true: AutoUpdateEnabled = false, want true")
	}
	for _, env := range []string{"0", "off", "false", "no", "OFF"} {
		t.Setenv("FOLDERLINK_AUTO_UPDATE", env)
		if got := (File{AutoUpdate: &on}).AutoUpdateEnabled(); got {
			t.Errorf("env %q: AutoUpdateEnabled = true, want false", env)
		}
	}
	for _, env := range []string{"1", "on", "true", "yes"} {
		t.Setenv("FOLDERLINK_AUTO_UPDATE", env)
		if got := (File{AutoUpdate: &off}).AutoUpdateEnabled(); !got {
			t.Errorf("env %q: AutoUpdateEnabled = false, want true", env)
		}
	}
	// An unrecognized value does not change the config setting.
	t.Setenv("FOLDERLINK_AUTO_UPDATE", "maybe")
	if got := (File{AutoUpdate: &off}).AutoUpdateEnabled(); got {
		t.Errorf("env maybe: AutoUpdateEnabled = true, want false (config wins)")
	}
	_ = os.Getenv("FOLDERLINK_AUTO_UPDATE")
}

func TestSetNotifySuccessKeepsFolders(t *testing.T) {
	dir := t.TempDir()
	folderDir := t.TempDir()
	store, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	// A folder added after the bridge started, by the separate allow
	// process. Toggling the tray setting must not drop it: the toggle
	// used to save the config the tray loaded at startup.
	if _, err := store.Allow(folderDir, "folderlink"); err != nil {
		t.Fatalf("Allow: %v", err)
	}
	if err := store.SetNotifySuccess(true); err != nil {
		t.Fatalf("SetNotifySuccess: %v", err)
	}
	cfg, err := store.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.NotifySuccess {
		t.Errorf("NotifySuccess = false, want true")
	}
	if len(cfg.Folders) != 1 || cfg.Folders[0].Label != "folderlink" {
		t.Errorf("Folders = %v, want one folderlink entry", cfg.Folders)
	}
}
