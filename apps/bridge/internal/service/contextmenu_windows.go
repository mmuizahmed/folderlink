//go:build windows

package service

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// The Explorer right-click verb is a plain registry entry, not a COM shell
// extension: no DLL, no registration server, nothing to sign. It lives
// under HKCU, so installing it needs no admin rights. Right-clicking a
// folder shows "Share with FolderLink", which runs the staged console
// binary with `allow "<folder>"` — the same command the user would type.
// If the folder is already allowed, `allow` just prints the existing
// entry and exits; that silent no-op is acceptable for v1.
const contextMenuKey = `Software\Classes\Directory\shell\FolderLink`

// contextMenuCommand is the command Explorer runs for the verb.
func contextMenuCommand(exe string) string {
	return fmt.Sprintf(`"%s" allow "%%1"`, exe)
}

// RegisterContextMenu adds the Explorer verb for the staged console
// binary. It is idempotent: re-running it overwrites the same values.
// A failure is returned but must not fail the install: the menu is a
// nicety, and doctor reports it.
func RegisterContextMenu() error {
	dir, err := InstallDir()
	if err != nil {
		return err
	}
	exe := filepath.Join(dir, "folderlink.exe")
	if _, err := os.Stat(exe); err != nil {
		return fmt.Errorf("folderlink.exe is not installed yet")
	}
	key, _, err := registry.CreateKey(registry.CURRENT_USER, contextMenuKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	if err := key.SetStringValue("", "Share with FolderLink"); err != nil {
		return err
	}
	if err := key.SetStringValue("Icon", exe); err != nil {
		return err
	}
	cmd, _, err := registry.CreateKey(registry.CURRENT_USER, contextMenuKey+`\command`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer cmd.Close()
	return cmd.SetStringValue("", contextMenuCommand(exe))
}

// RemoveContextMenu deletes the Explorer verb. Missing keys are fine.
func RemoveContextMenu() error {
	_ = registry.DeleteKey(registry.CURRENT_USER, contextMenuKey+`\command`)
	if err := registry.DeleteKey(registry.CURRENT_USER, contextMenuKey); err != nil {
		return err
	}
	return nil
}

// ContextMenuRegistered reports whether the Explorer verb points at the
// staged console binary.
func ContextMenuRegistered() bool {
	key, err := registry.OpenKey(registry.CURRENT_USER, contextMenuKey+`\command`, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer key.Close()
	value, _, err := key.GetStringValue("")
	if err != nil {
		return false
	}
	return strings.Contains(value, `folderlink.exe" allow "%1"`)
}
