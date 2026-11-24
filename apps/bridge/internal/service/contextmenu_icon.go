package service

import (
	"os"
	"path/filepath"
)

// The Explorer context menu shows an icon only when the verb's Icon value
// points at a real .ico file (or an exe carrying an icon resource).
// folderlink.exe has no embedded icon resource, so the verb used to point
// at it and Explorer showed a blank. The installer instead writes the
// FolderLink mark — the same .ico the tray uses — next to the staged
// binaries and points the verb at that file.

// menuIconName is the icon file in the install directory.
const menuIconName = "icon.ico"

// menuIconPath is where the context-menu icon lives in the install dir.
func menuIconPath(dir string) string {
	return filepath.Join(dir, menuIconName)
}

// writeMenuIcon writes the icon bytes to the install directory and returns
// the file path, for the verb's Icon value. It overwrites on re-install so
// a stale icon can never linger. A failure leaves the caller to fall back
// to the exe path: a missing icon must never fail the install.
func writeMenuIcon(dir string, icon []byte) (string, error) {
	path := menuIconPath(dir)
	if err := os.WriteFile(path, icon, 0o600); err != nil {
		return "", err
	}
	return path, nil
}
