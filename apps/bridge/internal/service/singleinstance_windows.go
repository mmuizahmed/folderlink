//go:build windows

package service

import (
	"errors"

	"golang.org/x/sys/windows"
)

// singleInstanceMutexName is the named mutex that marks a running bridge.
// It lives in the session namespace (Local\), so one user cannot block
// another. The OS releases it when the owning process exits, so there is
// no stale lock to clean up after a crash.
const singleInstanceMutexName = "Local\\Muiz.FolderLink"

// TryAcquireSingleInstance claims the bridge mutex. It returns a release
// function (always non-nil; a no-op when nothing was acquired), whether
// another bridge already holds the mutex, and any error. When another
// bridge is already running the caller should tell the user and exit
// instead of starting a second bridge: a duplicate would fight the first
// for the connection and the tray icon.
func TryAcquireSingleInstance() (release func(), alreadyRunning bool, err error) {
	name, err := windows.UTF16PtrFromString(singleInstanceMutexName)
	if err != nil {
		return func() {}, false, err
	}
	handle, err := windows.CreateMutex(nil, false, name)
	if err != nil {
		if errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
			// Another bridge owns the mutex. Close our handle to it and
			// report that one is already running.
			windows.CloseHandle(handle)
			return func() {}, true, nil
		}
		return func() {}, false, err
	}
	return func() { windows.CloseHandle(handle) }, false, nil
}
