//go:build windows

package service

import (
	"strings"
	"testing"
)

func TestClearBatteryConditions(t *testing.T) {
	var gotName string
	var gotArgs []string
	oldRun := run
	run = func(name string, args ...string) error {
		gotName, gotArgs = name, args
		return nil
	}
	t.Cleanup(func() { run = oldRun })
	if err := clearBatteryConditions(); err != nil {
		t.Fatalf("clearBatteryConditions: %v", err)
	}
	if gotName != "powershell" {
		t.Fatalf("clearBatteryConditions ran %q, want powershell", gotName)
	}
	joined := strings.Join(gotArgs, " ")
	for _, want := range []string{"-NoProfile", "-Command", batteryFixScript} {
		if !strings.Contains(joined, want) {
			t.Errorf("clearBatteryConditions args %q are missing %q", joined, want)
		}
	}
}
