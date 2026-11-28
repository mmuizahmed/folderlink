//go:build !windows

package service

// TryAcquireSingleInstance is a no-op off Windows: the tray is
// Windows-only in practice, and other platforms have no named mutex to
// claim. It reports that no other bridge is running.
func TryAcquireSingleInstance() (release func(), alreadyRunning bool, err error) {
	return func() {}, false, nil
}
