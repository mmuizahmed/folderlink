package main

import (
	"testing"
)

// isBackgroundBinary is tested through the name check it is built on: the
// tray must only start for the no-console binary, never for the console
// binary the user runs by hand.
func TestIsBackgroundBinaryName(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{"folderlink-bg", true},
		{"folderlink-bg.exe", true},
		{`/tmp/folderlink-bg.exe`, true},
		{"folderlink", false},
		{"folderlink.exe", false},
		{"folderlink-bg2.exe", false},
	}
	for _, tc := range cases {
		if got := isBackgroundBinaryName(tc.name); got != tc.want {
			t.Errorf("isBackgroundBinaryName(%q) = %v, want %v", tc.name, got, tc.want)
		}
	}
}
