//go:build windows

package service

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"

	"github.com/go-ole/go-ole"

	"github.com/mmuizahmed/folderlink/apps/bridge/internal/notify"
)

// toastShortcutPath is the Start Menu shortcut that gives FolderLink its
// notification identity. Windows only shows toasts for an unpackaged
// desktop app when such a shortcut exists with the AppUserModelID set.
func toastShortcutPath() (string, error) {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		appData = filepath.Join(home, "AppData", "Roaming")
	}
	return filepath.Join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "FolderLink.lnk"), nil
}

// ToastShortcutExists reports whether the notification shortcut is in
// place. It does not verify the AppUserModelID property; that is only
// set by EnsureToastShortcut.
func ToastShortcutExists() bool {
	path, err := toastShortcutPath()
	if err != nil {
		return false
	}
	_, err = os.Stat(path)
	return err == nil
}

// EnsureToastShortcut creates the Start Menu shortcut for the background
// binary with the FolderLink AppUserModelID, so Windows shows toasts.
// It is idempotent: when the shortcut already exists it is left alone.
// A failure is returned but must not fail the install: toasts are a
// nicety, and a missing shortcut only means notifications are silent
// (doctor reports it).
func EnsureToastShortcut() error {
	target, err := InstallDir()
	if err != nil {
		return err
	}
	exe := filepath.Join(target, "folderlink-bg.exe")
	if _, err := os.Stat(exe); err != nil {
		return fmt.Errorf("the background binary is not installed yet")
	}
	lnk, err := toastShortcutPath()
	if err != nil {
		return err
	}
	if _, err := os.Stat(lnk); err == nil {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(lnk), 0o755); err != nil {
		return err
	}
	return createShortcut(lnk, exe)
}

var (
	clsidShellLink    = ole.NewGUID("{00021401-0000-0000-C000-000000000046}")
	iidShellLink      = ole.NewGUID("{000214F9-0000-0000-C000-000000000046}")
	iidPropertyStore  = ole.NewGUID("{886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99}")
	iidPersistFile    = ole.NewGUID("{0000010B-0000-0000-C000-000000000046}")
	appUserModelIDKey = propertyKey{
		fmtid: *ole.NewGUID("{9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}"),
		pid:   5,
	}
)

type propertyKey struct {
	fmtid ole.GUID
	pid   uint32
}

// propVariant is the 16-byte COM PROPVARIANT. Only VT_LPWSTR (a UTF-16
// string pointer) is used here. The value is an unsafe.Pointer, not a
// uintptr, so go vet does not flag the COM allocation as a misuse — the
// memory is owned by ole32 and freed by PropVariantClear.
type propVariant struct {
	vt        uint16
	reserved1 uint16
	reserved2 uint16
	reserved3 uint16
	value     unsafe.Pointer
}

const vtLPWSTR = 31

// createShortcut writes a .lnk with the AppUserModelID property. It uses
// raw COM (IShellLink, IPropertyStore, IPersistFile) because a plain
// WScript.Shell shortcut cannot carry the property, and the property is
// what makes Windows deliver toasts for this app.
func createShortcut(lnkPath, target string) error {
	if err := ole.CoInitialize(0); err != nil {
		return err
	}
	defer ole.CoUninitialize()
	link, err := ole.CreateInstance(clsidShellLink, iidShellLink)
	if err != nil {
		return err
	}
	defer link.Release()
	// IShellLinkW vtable: SetDescription is slot 7, SetIconLocation 17,
	// SetPath 20 (after the three IUnknown slots).
	targetPtr, err := syscall.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	if hr := vtCall(link, 20, uintptr(unsafe.Pointer(link)), uintptr(unsafe.Pointer(targetPtr))); hr != 0 {
		return fmt.Errorf("IShellLink.SetPath failed: %#x", hr)
	}
	descPtr, err := syscall.UTF16PtrFromString("FolderLink")
	if err != nil {
		return err
	}
	if hr := vtCall(link, 7, uintptr(unsafe.Pointer(link)), uintptr(unsafe.Pointer(descPtr))); hr != 0 {
		return fmt.Errorf("IShellLink.SetDescription failed: %#x", hr)
	}
	if hr := vtCall(link, 17, uintptr(unsafe.Pointer(link)), uintptr(unsafe.Pointer(targetPtr)), 0); hr != 0 {
		return fmt.Errorf("IShellLink.SetIconLocation failed: %#x", hr)
	}
	store, err := queryInterface(link, iidPropertyStore)
	if err != nil {
		return err
	}
	defer store.Release()
	// IPropertyStore vtable: SetValue is slot 6, Commit is slot 7.
	value, err := newLPWSTRVariant(notify.AppID)
	if err != nil {
		return err
	}
	defer clearVariant(value)
	if hr := vtCall(store, 6, uintptr(unsafe.Pointer(store)), uintptr(unsafe.Pointer(&appUserModelIDKey)), uintptr(unsafe.Pointer(value))); hr != 0 {
		return fmt.Errorf("IPropertyStore.SetValue failed: %#x", hr)
	}
	if hr := vtCall(store, 7, uintptr(unsafe.Pointer(store))); hr != 0 {
		return fmt.Errorf("IPropertyStore.Commit failed: %#x", hr)
	}
	persist, err := queryInterface(link, iidPersistFile)
	if err != nil {
		return err
	}
	defer persist.Release()
	// IPersistFile vtable: Save is slot 6.
	lnkPtr, err := syscall.UTF16PtrFromString(lnkPath)
	if err != nil {
		return err
	}
	if hr := vtCall(persist, 6, uintptr(unsafe.Pointer(persist)), uintptr(unsafe.Pointer(lnkPtr)), 1); hr != 0 {
		return fmt.Errorf("IPersistFile.Save failed: %#x", hr)
	}
	return nil
}

// vtSlot returns the function pointer for a COM vtable slot.
func vtSlot(obj *ole.IUnknown, slot int) uintptr {
	slots := (*[256]uintptr)(unsafe.Pointer(obj.VTable()))
	return slots[slot]
}

// queryInterface calls IUnknown::QueryInterface (vtable slot 0) and
// returns the result as an *IUnknown. go-ole's QueryInterface method
// returns an *IDispatch, which is the wrong type for the raw vtable
// calls in this file.
func queryInterface(unk *ole.IUnknown, iid *ole.GUID) (*ole.IUnknown, error) {
	var out *ole.IUnknown
	hr, _, _ := syscall.SyscallN(vtSlot(unk, 0),
		uintptr(unsafe.Pointer(unk)),
		uintptr(unsafe.Pointer(iid)),
		uintptr(unsafe.Pointer(&out)))
	if hr != 0 {
		return nil, ole.NewError(hr)
	}
	return out, nil
}

// vtCall invokes a COM vtable slot. The first argument is always the
// interface pointer itself.
func vtCall(obj *ole.IUnknown, slot int, args ...uintptr) uintptr {
	ret, _, _ := syscall.SyscallN(vtSlot(obj, slot), args...)
	return ret
}

// newLPWSTRVariant allocates a PROPVARIANT holding a copy of s as a
// CoTaskMem string, so PropVariantClear can free it.
func newLPWSTRVariant(s string) (*propVariant, error) {
	utf16, err := syscall.UTF16FromString(s)
	if err != nil {
		return nil, err
	}
	size := uintptr(len(utf16)) * 2
	mem := coTaskMemAlloc(size)
	if mem == nil {
		return nil, fmt.Errorf("out of memory")
	}
	dst := (*[1 << 20]uint16)(mem)[:len(utf16)]
	copy(dst, utf16)
	return &propVariant{vt: vtLPWSTR, value: mem}, nil
}

var (
	procCoTaskMemAlloc   = syscall.NewLazyDLL("ole32.dll").NewProc("CoTaskMemAlloc")
	procPropVariantClear = syscall.NewLazyDLL("ole32.dll").NewProc("PropVariantClear")
)

// coTaskMemAlloc allocates COM task memory (freed by PropVariantClear for
// the PROPVARIANT below). x/sys/windows does not export CoTaskMemAlloc,
// so it is called through ole32 directly. The uintptr-to-pointer
// conversion here is COM interop, not Go memory: go vet flags it
// ("possible misuse of unsafe.Pointer"), the same way Windows vet is
// already not clean for this repo (guard_test.go uses syscall.Mkfifo).
// CI vets Linux only, where this file is not compiled.
func coTaskMemAlloc(size uintptr) unsafe.Pointer {
	ptr, _, _ := procCoTaskMemAlloc.Call(size)
	return unsafe.Pointer(ptr)
}

func clearVariant(v *propVariant) {
	_, _, _ = procPropVariantClear.Call(uintptr(unsafe.Pointer(v)))
}
