//go:build windows

package notify

import (
	_ "embed"
	"encoding/base64"
	"log/slog"
	"strings"

	"github.com/gen2brain/beeep"
	"golang.org/x/sys/windows"
)

// The toast icon is stored as base64 text, not a binary: the GitHub push
// route only accepts UTF-8 files, so the .png lives here as .b64 and is
// decoded at startup. Same bytes, same toast icon.
//
//go:embed icon.png.b64
var iconPNGBase64 string

var iconPNG []byte

func init() {
	iconPNG = decodeIcon(iconPNGBase64)
}

// decodeIcon turns a base64 icon back into bytes. A corrupt icon logs and
// yields nil (the toast is sent without an icon) instead of crashing the bridge.
func decodeIcon(b64 string) []byte {
	b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b64))
	if err != nil {
		slog.Warn("notification icon did not decode", "err", err.Error())
		return nil
	}
	return b
}

// show sends one toast. beeep.AppName must equal the AppUserModelID, or
// Windows files the toast under the wrong identity. A nil error does not
// prove the banner appeared: without the Start Menu shortcut Windows
// drops it silently (see the package doc).
func show(title, body string) {
	beeep.AppName = AppID
	if err := beeep.Notify(title, body, iconPNG); err != nil {
		slog.Warn("notification failed", "err", err.Error())
	}
}

// EnsureAppIdentity sets the AppUserModelID on this process, so toasts and
// the taskbar group under FolderLink instead of the hosting process. It
// must be called before any window exists, i.e. at background startup.
func EnsureAppIdentity() {
	id, err := windows.UTF16PtrFromString(AppID)
	if err != nil {
		return
	}
	// SetCurrentProcessExplicitAppUserModelID is in shell32.dll.
	if err := setCurrentProcessExplicitAppUserModelID(id); err != nil {
		slog.Warn("could not set the app identity for notifications", "err", err.Error())
	}
}
