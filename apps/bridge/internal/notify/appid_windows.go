//go:build windows

package notify

import (
	"syscall"
	"unsafe"
)

var (
	modShell32                                  = syscall.NewLazyDLL("shell32.dll")
	procSetCurrentProcessExplicitAppUserModelID = modShell32.NewProc("SetCurrentProcessExplicitAppUserModelID")
)

func setCurrentProcessExplicitAppUserModelID(id *uint16) error {
	ret, _, err := procSetCurrentProcessExplicitAppUserModelID.Call(uintptr(unsafe.Pointer(id)))
	if ret != 0 {
		if err != nil && err != syscall.Errno(0) {
			return err
		}
		return syscall.Errno(ret)
	}
	return nil
}
