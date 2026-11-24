//go:build !windows

package update

import "errors"

// ApplyWindows is only for Windows. On macOS and Linux the bridge swaps
// the binary in place (a running binary can be replaced there) and exits;
// the LaunchAgent or systemd unit restarts it.
func ApplyWindows(staged map[string]string, pid int) error {
	return errors.New("the Windows update helper is not available on this platform")
}
