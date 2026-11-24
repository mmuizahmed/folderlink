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
