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
//
// Install first copies the running binary to a stable directory
// (%LOCALAPPDATA%\FolderLink on Windows, ~/.local/share/folderlink
// elsewhere) and points the login task at that copy, so it keeps working
// if the user moves or deletes the download folder. Install also starts
// the bridge immediately and verifies the registration actually exists,
// instead of silently succeeding.
package service

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Install registers FolderLink to start at login, copies the binary to a
// stable location first, starts the bridge now, and verifies the
// registration actually exists.
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

// InstallDir is the stable directory the background copy lives in, so the
// login task keeps working if the user moves or deletes the download folder.
func InstallDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return installDirFor(runtime.GOOS, os.Getenv("LOCALAPPDATA"), home)
}

// installDirFor is InstallDir with its inputs exposed, for tests.
func installDirFor(goos, localAppData, home string) (string, error) {
	if home == "" {
		return "", errors.New("cannot find the user home directory")
	}
	switch goos {
	case "windows":
		base := localAppData
		if base == "" {
			base = filepath.Join(home, "AppData", "Local")
		}
		return filepath.Join(base, "FolderLink"), nil
	case "darwin", "linux":
		return filepath.Join(home, ".local", "share", "folderlink"), nil
	default:
		return "", errors.New("background install is not supported on this operating system")
	}
}

// desktopShortcutPathFor is the Desktop shortcut location for a home
// directory, exposed so tests can check it without a Windows machine.
// The Desktop folder is %USERPROFILE%\Desktop on Windows.
func desktopShortcutPathFor(home string) string {
	return filepath.Join(home, "Desktop", "FolderLink.lnk")
}

// installBinaryName is the file the login task runs: the no-console build on
// Windows, the plain binary everywhere else.
func installBinaryName() string {
	if runtime.GOOS == "windows" {
		return "folderlink-bg.exe"
	}
	return "folderlink"
}

// stageBinary copies the running bridge into the install directory and
// returns the path of the copy the login task should run. On Windows it
// also copies folderlink-bg.exe next to it when present, and returns that
// copy, because the windowsgui build has no console window. When the binary
// is already in the install directory (the installer runs it from there),
// there is nothing to copy.
func stageBinary() (string, error) {
	dir, err := InstallDir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	self, err := os.Executable()
	if err != nil {
		return "", err
	}
	target := filepath.Join(dir, filepath.Base(self))
	if !sameFile(self, target) {
		if _, err := copyFile(self, target); err != nil {
			return "", err
		}
	}
	if runtime.GOOS == "windows" {
		bg := filepath.Join(filepath.Dir(self), "folderlink-bg.exe")
		bgTarget := filepath.Join(dir, "folderlink-bg.exe")
		if _, err := os.Stat(bg); err == nil {
			if !sameFile(bg, bgTarget) {
				if _, err := copyFile(bg, bgTarget); err != nil {
					return "", err
				}
			}
			return bgTarget, nil
		}
	}
	return target, nil
}

// sameFile reports whether two paths name the same file. Windows paths are
// case-insensitive; everywhere else they are not.
func sameFile(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// copyFile copies src to dst atomically (via a temp file and rename) and
// returns dst. It never modifies src, so re-installing over a running copy
// on Windows only works after the old bridge is stopped first.
func copyFile(src, dst string) (string, error) {
	data, err := os.ReadFile(src)
	if err != nil {
		return "", err
	}
	tmp := dst + ".new"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	// The staged copy is a binary, so it has to be executable. Write it at
	// 0600 and chmod after, rather than writing it 0755 directly.
	if err := os.Chmod(tmp, 0o755); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	return dst, nil
}

// verifyInstalled checks the login registration actually exists after
// Install. A create command can report success while the task is missing
// (a stale task, a permissions quirk); this catches that.
func verifyInstalled() error {
	installed, err := Installed()
	if err != nil {
		return err
	}
	if !installed {
		return errors.New("background install did not take effect: the login task was not created")
	}
	return nil
}

// RepairLogonPower clears the logon task's battery conditions on a
// machine that was installed before install started doing it, and
// verifies the repair took effect by re-reading the task settings. It is
// what `folderlink doctor --fix` runs. Windows-only: the other platforms
// have no such conditions.
func RepairLogonPower() error {
	if runtime.GOOS != "windows" {
		return errors.New("the logon task is Windows-only")
	}
	installed, err := Installed()
	if err != nil {
		return err
	}
	if !installed {
		return errors.New("not installed — run folderlink install first")
	}
	if err := clearBatteryConditions(); err != nil {
		return err
	}
	out, err := runOutput("schtasks", "/query", "/tn", "FolderLink", "/xml")
	if err != nil {
		return fmt.Errorf("could not verify the repair: %w", err)
	}
	blocked, err := batteryConditionsBlocked(out)
	if err != nil {
		return fmt.Errorf("could not verify the repair: %w", err)
	}
	if blocked {
		return errors.New("the battery conditions are still set — try running from an elevated PowerShell")
	}
	return nil
}

// Stop halts the background bridge without removing the login
// registration, so an update can replace the binary. Best effort: a
// bridge that is not running reports an error here, and that is fine.
func Stop() error {
	switch runtime.GOOS {
	case "windows":
		return run("schtasks", "/end", "/tn", "FolderLink")
	case "darwin":
		return run("launchctl", "unload", launchAgentPath())
	case "linux":
		return run("systemctl", "--user", "stop", "folderlink.service")
	default:
		return errors.New("background install is not supported on this operating system")
	}
}

// Start launches the background bridge again after an update.
func Start() error {
	switch runtime.GOOS {
	case "windows":
		return run("schtasks", "/run", "/tn", "FolderLink")
	case "darwin":
		return run("launchctl", "load", launchAgentPath())
	case "linux":
		return run("systemctl", "--user", "start", "folderlink.service")
	default:
		return errors.New("background install is not supported on this operating system")
	}
}

// Uninstall stops the bridge, removes the login registration created by
// Install, and removes the staged copy. The staged files are best effort:
// on Windows a still-running bridge locks its own exe, so they may be left
// behind until the next login.
func Uninstall() error {
	switch runtime.GOOS {
	case "windows":
		// Stop the running bridge first, otherwise its exe is locked and
		// the staged copy below cannot be removed.
		_ = run("schtasks", "/end", "/tn", "FolderLink")
		if err := run("schtasks", "/delete", "/tn", "FolderLink", "/f"); err != nil {
			return err
		}
		// Best effort: the task is already gone, which is what stops
		// the bridge; a leftover verb is just a dead menu entry.
		_ = RemoveContextMenu()
		return removeInstallDir()
	case "darwin":
		plist := launchAgentPath()
		_ = run("launchctl", "unload", plist)
		if err := os.Remove(plist); err != nil && !os.IsNotExist(err) {
			return err
		}
		return removeInstallDir()
	case "linux":
		unit := systemdUnitPath()
		// Best effort: on a machine without a user bus, disable fails, but
		// removing the unit file is what actually stops the service.
		_ = run("systemctl", "--user", "disable", "--now", "folderlink.service")
		if err := os.Remove(unit); err != nil && !os.IsNotExist(err) {
			return err
		}
		_ = run("systemctl", "--user", "daemon-reload")
		return removeInstallDir()
	default:
		return errors.New("background uninstall is not supported on this operating system")
	}
}

// removeInstallDir deletes the staged copy. Errors are ignored: the
// registration above is already gone, which is what stops the bridge.
func removeInstallDir() error {
	dir, err := InstallDir()
	if err != nil {
		return nil
	}
	_ = os.RemoveAll(dir)
	return nil
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
		out, err := runOutput("systemctl", "--user", "is-enabled", "folderlink.service")
		if err == nil {
			return strings.TrimSpace(out) == "enabled", nil
		}
		return false, nil
	default:
		return false, errors.New("background install is not supported on this operating system")
	}
}

func installWindows() error {
	// Stop any running bridge first: the staged copy is locked while it runs.
	_ = run("schtasks", "/end", "/tn", "FolderLink")
	exe, err := stageBinary()
	if err != nil {
		return err
	}
	// /it runs the task in the interactive session, so the folder picker
	// dialog can appear. /rl limited keeps it at the user's privilege.
	// /f replaces an older FolderLink task.
	if err := run(
		"schtasks", "/create",
		"/tn", "FolderLink",
		"/tr", fmt.Sprintf(`"%s" run`, exe),
		"/sc", "onlogon",
		"/it",
		"/rl", "limited",
		"/f",
	); err != nil {
		return err
	}
	if err := verifyInstalled(); err != nil {
		return err
	}
	// schtasks /create leaves the AC-power conditions on: a laptop on
	// battery at logon silently skips the task, so the bridge never
	// starts and nothing reports it. Clear them now. Best effort: a
	// failure only means doctor will flag the condition.
	if err := clearBatteryConditions(); err != nil {
		slog.Warn("logon task may not start on battery power", "err", err.Error())
	}
	// The Start Menu shortcut gives FolderLink its notification identity
	// (AppUserModelID). Best effort: a missing shortcut only means
	// toasts are silent, and doctor reports it.
	if err := EnsureToastShortcut(); err != nil {
		slog.Warn("notification shortcut was not created", "err", err.Error())
	}
	// The Desktop shortcut lets the user start FolderLink again after
	// quitting from the tray. Best effort, like the notification
	// shortcut: a missing shortcut only means no desktop icon, and
	// doctor reports it.
	if err := EnsureDesktopShortcut(); err != nil {
		slog.Warn("desktop shortcut was not created", "err", err.Error())
	}
	// The Explorer right-click verb. Best effort as well: a missing verb
	// only means no context menu, and doctor reports it.
	if err := RegisterContextMenu(); err != nil {
		slog.Warn("Explorer context menu was not registered", "err", err.Error())
	}
	// Start it now, so the user does not have to log out and back in.
	// A task that is already running reports an error here; that means the
	// bridge is up, which is the outcome we want.
	if err := run("schtasks", "/run", "/tn", "FolderLink"); err != nil && !IsAlreadyRunning(err) {
		return fmt.Errorf("background task was created but could not be started: %w", err)
	}
	return nil
}

// IsAlreadyRunning reports whether err is the "task is already running"
// error from schtasks. An already-running bridge is the outcome we want,
// not a failure: it is what install checks for after creating the task,
// and what `folderlink start` treats as success.
func IsAlreadyRunning(err error) bool {
	return err != nil && strings.Contains(err.Error(), "already running")
}

func installDarwin() error {
	exe, err := stageBinary()
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
	if err := os.WriteFile(plist, []byte(body), 0o600); err != nil {
		return err
	}
	// load starts the bridge now (RunAtLoad); verify it took effect.
	if err := run("launchctl", "load", plist); err != nil {
		return err
	}
	return verifyInstalled()
}

func launchAgentPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "LaunchAgents", "com.folderlink.bridge.plist")
}

func installLinux() error {
	exe, err := stageBinary()
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
	if err := os.WriteFile(unit, []byte(body), 0o600); err != nil {
		return err
	}
	if err := run("systemctl", "--user", "daemon-reload"); err != nil {
		return err
	}
	// --now starts the bridge immediately; verify it took effect.
	if err := run("systemctl", "--user", "enable", "--now", "folderlink.service"); err != nil {
		return err
	}
	return verifyInstalled()
}

func systemdUnitPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "systemd", "user", "folderlink.service")
}

// run, runOutput and httpGet are variables so tests can stub them; the
// client tests already stub browser.Open the same way.
var run = func(name string, args ...string) error {
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

var runOutput = func(name string, args ...string) (string, error) {
	out, err := exec.Command(name, args...).CombinedOutput()
	return string(out), err
}

var httpGet = func(rawURL string) (int, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	res, err := client.Get(rawURL)
	if err != nil {
		return 0, err
	}
	defer func() { _ = res.Body.Close() }()
	return res.StatusCode, nil
}

func isNotFound(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "ERROR: The system cannot find") ||
		strings.Contains(err.Error(), "does not exist"))
}
