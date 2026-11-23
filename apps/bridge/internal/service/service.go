// Package service installs FolderLink as a background program that starts
// when the user logs in, with no console window.
//
// The bridge must run in the user's own session, not as a system service:
// the folder picker opens a dialog on the user's desktop, and a Windows
// service in session 0 cannot show one. On Windows the scheduled task runs
// the companion folderlink-bg.exe binary, which is built with the
// windowsgui subsystem so no console window appears. On macOS and Linux
// the plain folderlink binary is used, because LaunchAgents and systemd
// user services never allocate a console.
package service

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Install registers FolderLink to start at login. It prints what it did.
func Install() error {
	switch runtime.GOOS {
	case "windows":
		return installWindows()
	case "darwin":
		return installDarwin()
	case "linux":
		return installLinux()
	default:
		return errors.New("background install is not supported on this operating system")
	}
}

// Uninstall removes the login registration created by Install.
func Uninstall() error {
	switch runtime.GOOS {
	case "windows":
		return run("schtasks", "/delete", "/tn", "FolderLink", "/f")
	case "darwin":
		plist := launchAgentPath()
		_ = run("launchctl", "unload", plist)
		if err := os.Remove(plist); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	case "linux":
		unit := systemdUnitPath()
		// Best effort: on a machine without a user bus, disable fails, but
		// removing the unit file is what actually stops the service.
		_ = run("systemctl", "--user", "disable", "--now", "folderlink.service")
		if err := os.Remove(unit); err != nil && !os.IsNotExist(err) {
			return err
		}
		_ = run("systemctl", "--user", "daemon-reload")
		return nil
	default:
		return errors.New("background uninstall is not supported on this operating system")
	}
}

// Installed reports whether the login registration exists.
func Installed() (bool, error) {
	switch runtime.GOOS {
	case "windows":
		err := run("schtasks", "/query", "/tn", "FolderLink")
		if err == nil {
			return true, nil
		}
		if isNotFound(err) {
			return false, nil
		}
		return false, err
	case "darwin":
		_, err := os.Stat(launchAgentPath())
		if err == nil {
			return true, nil
		}
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	case "linux":
		out, err := exec.Command("systemctl", "--user", "is-enabled", "folderlink.service").Output()
		if err == nil {
			return strings.TrimSpace(string(out)) == "enabled", nil
		}
		return false, nil
	default:
		return false, errors.New("background install is not supported on this operating system")
	}
}

func installWindows() error {
	exe, err := backgroundBinary()
	if err != nil {
		return err
	}
	// /it runs the task in the interactive session, so the folder picker
	// dialog can appear. /rl limited keeps it at the user's privilege.
	// /f replaces an older FolderLink task.
	return run(
		"schtasks", "/create",
		"/tn", "FolderLink",
		"/tr", fmt.Sprintf(`"%s" run`, exe),
		"/sc", "onlogon",
		"/it",
		"/rl", "limited",
		"/f",
	)
}

// backgroundBinary is the executable the login task should run. On Windows
// that is folderlink-bg.exe next to this binary when it exists, because the
// windowsgui build has no console window. Everywhere else it is this binary.
func backgroundBinary() (string, error) {
	self, err := os.Executable()
	if err != nil {
		return "", err
	}
	if runtime.GOOS == "windows" {
		dir := filepath.Dir(self)
		bg := filepath.Join(dir, "folderlink-bg.exe")
		if _, err := os.Stat(bg); err == nil {
			return bg, nil
		}
	}
	return self, nil
}

func installDarwin() error {
	exe, err := backgroundBinary()
	if err != nil {
		return err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	dir := filepath.Join(home, "Library", "LaunchAgents")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	plist := launchAgentPath()
	body := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.folderlink.bridge</string>
  <key>ProgramArguments</key><array><string>` + exe + `</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>` + filepath.Join(home, "Library", "Logs", "folderlink.log") + `</string>
  <key>StandardErrorPath</key><string>` + filepath.Join(home, "Library", "Logs", "folderlink.log") + `</string>
</dict>
</plist>
`
	if err := os.WriteFile(plist, []byte(body), 0o644); err != nil {
		return err
	}
	return run("launchctl", "load", plist)
}

func launchAgentPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "LaunchAgents", "com.folderlink.bridge.plist")
}

func installLinux() error {
	exe, err := backgroundBinary()
	if err != nil {
		return err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	dir := filepath.Join(home, ".config", "systemd", "user")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	unit := systemdUnitPath()
	body := `[Unit]
Description=FolderLink bridge
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=` + exe + ` run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`
	if err := os.WriteFile(unit, []byte(body), 0o644); err != nil {
		return err
	}
	if err := run("systemctl", "--user", "daemon-reload"); err != nil {
		return err
	}
	return run("systemctl", "--user", "enable", "--now", "folderlink.service")
}

func systemdUnitPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "systemd", "user", "folderlink.service")
}

func run(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		trimmed := strings.TrimSpace(string(out))
		if trimmed != "" {
			return fmt.Errorf("%s: %s", name, trimmed)
		}
		return err
	}
	return nil
}

func isNotFound(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "ERROR: The system cannot find") ||
		strings.Contains(err.Error(), "does not exist"))
}
