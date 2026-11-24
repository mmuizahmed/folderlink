// Doctor checks for `folderlink doctor`: it looks at the install, the login
// task, the running bridge, the server, pairing, and the last connection,
// and says what is wrong in plain words. Every check is independent, so one
// failure does not hide the others.
package service

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/client"
)

// Check statuses.
const (
	// CheckOK means the check passed.
	CheckOK = "ok"
	// CheckFail means something is wrong; Detail says what to do.
	CheckFail = "FAIL"
	// CheckSkip means the check could not run (usually because an earlier
	// check already explains the problem).
	CheckSkip = "skip"
)

// Check is one doctor result.
type Check struct {
	Name   string
	Status string // ok, FAIL, or skip
	Detail string
}

// DoctorConfig wires the doctor's inputs.
type DoctorConfig struct {
	// Server is the worker base URL, e.g. https://folderlink.muiz.pk.
	Server string
	// HomeDir is the config directory (identity and last-connected live here).
	HomeDir string
	// PairState reports the pairing state from the server ("active",
	// "absent", "revoked"). Nil skips the pairing check.
	PairState func(context.Context) (string, error)
}

// Doctor runs the checks in order and returns them.
func Doctor(cfg DoctorConfig) []Check {
	installed, _ := Installed()
	return []Check{
		checkStagedCopy(),
		checkInstalled(installed),
		checkEnabled(installed),
		checkToastShortcut(),
		checkContextMenu(),
		checkProcessRunning(),
		checkServerReachable(cfg.Server),
		checkPairing(cfg.PairState),
		checkLastConnected(cfg.HomeDir),
	}
}

func checkStagedCopy() Check {
	dir, err := InstallDir()
	if err != nil {
		return Check{"Background copy", CheckFail, "cannot find the install location: " + err.Error()}
	}
	// The task runs the no-console build on Windows when it was staged;
	// otherwise it runs the console copy.
	bg := filepath.Join(dir, "folderlink-bg.exe")
	if _, err := os.Stat(bg); err == nil {
		return Check{"Background copy", CheckOK, "installed copy is at " + bg}
	}
	plain := filepath.Join(dir, installBinaryName())
	if _, err := os.Stat(plain); err == nil {
		return Check{"Background copy", CheckOK, "installed copy is at " + plain + " (console build — re-run folderlink install from the full release zip to get the no-console build)"}
	}
	return Check{"Background copy", CheckFail, "no copy in " + dir + " — run folderlink install"}
}

func checkInstalled(installed bool) Check {
	if !installed {
		return Check{"Background install", CheckFail, "not installed — run folderlink install"}
	}
	// The registration must point at the staged copy, not at a download
	// folder the user may delete later.
	dir, err := InstallDir()
	if err != nil || dir == "" {
		return Check{"Background install", CheckOK, "starts automatically at login"}
	}
	if pointsAtInstallDir(dir) {
		return Check{"Background install", CheckOK, "starts automatically at login"}
	}
	return Check{"Background install", CheckFail, "installed, but it does not point at the copy in " + dir + " — run folderlink install again"}
}

// pointsAtInstallDir reports whether the login registration runs a binary
// from the install directory.
func pointsAtInstallDir(dir string) bool {
	switch runtime.GOOS {
	case "windows":
		out, err := runOutput("schtasks", "/query", "/tn", "FolderLink", "/xml")
		if err != nil {
			return false
		}
		return strings.Contains(out, dir)
	case "darwin":
		raw, err := os.ReadFile(launchAgentPath())
		if err != nil {
			return false
		}
		return strings.Contains(string(raw), dir)
	case "linux":
		raw, err := os.ReadFile(systemdUnitPath())
		if err != nil {
			return false
		}
		return strings.Contains(string(raw), dir)
	default:
		return false
	}
}

func checkEnabled(installed bool) Check {
	if !installed {
		return Check{"Login task", CheckSkip, "not installed"}
	}
	switch runtime.GOOS {
	case "windows":
		out, err := runOutput("schtasks", "/query", "/tn", "FolderLink", "/v", "/fo", "list")
		if err != nil {
			return Check{"Login task", CheckFail, "cannot read the task: " + err.Error()}
		}
		for _, line := range strings.Split(out, "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "Status:") {
				status := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "Status:"))
				switch status {
				case "Ready", "Running":
					return Check{"Login task", CheckOK, "enabled (" + strings.ToLower(status) + ")"}
				case "Disabled":
					return Check{"Login task", CheckFail, "task is disabled — enable it in Task Scheduler, or run folderlink install again"}
				default:
					return Check{"Login task", CheckFail, "task status is " + status}
				}
			}
		}
		return Check{"Login task", CheckFail, "cannot read the task status"}
	case "darwin":
		if err := run("launchctl", "list", "com.folderlink.bridge"); err != nil {
			return Check{"Login task", CheckFail, "installed but not loaded — run folderlink install again"}
		}
		return Check{"Login task", CheckOK, "loaded"}
	case "linux":
		out, err := runOutput("systemctl", "--user", "is-enabled", "folderlink.service")
		if err != nil || strings.TrimSpace(out) != "enabled" {
			return Check{"Login task", CheckFail, "service is not enabled — run folderlink install again"}
		}
		return Check{"Login task", CheckOK, "enabled"}
	default:
		return Check{"Login task", CheckSkip, "not supported on this operating system"}
	}
}

func checkToastShortcut() Check {
	if runtime.GOOS != "windows" {
		return Check{"Notifications", CheckSkip, "notifications are Windows-only"}
	}
	if ToastShortcutExists() {
		return Check{"Notifications", CheckOK, "Start Menu shortcut is in place, so toasts can show"}
	}
	return Check{"Notifications", CheckFail, "notification shortcut is missing — toasts will be silent; run folderlink install again"}
}

func checkContextMenu() Check {
	if runtime.GOOS != "windows" {
		return Check{"Explorer menu", CheckSkip, "the Explorer menu is Windows-only"}
	}
	if ContextMenuRegistered() {
		return Check{"Explorer menu", CheckOK, "right-click a folder > Share with FolderLink is registered"}
	}
	return Check{"Explorer menu", CheckFail, "right-click menu is missing — run folderlink install again"}
}

func checkProcessRunning() Check {
	switch runtime.GOOS {
	case "windows":
		// Only the background binary is checked: the doctor itself runs
		// as folderlink.exe, so that name would always match.
		out, err := runOutput("tasklist", "/fi", "imagename eq folderlink-bg.exe", "/fo", "csv")
		if err == nil && strings.Contains(out, "folderlink-bg.exe") {
			return Check{"Bridge process", CheckOK, "folderlink-bg.exe is running"}
		}
		return Check{"Bridge process", CheckFail, "the background bridge is not running — run folderlink install, then check the tray icon"}
	default:
		// "folderlink run" matches the bridge but not this doctor run
		// ("folderlink doctor").
		out, err := runOutput("ps", "-ax", "-o", "args=")
		if err == nil && strings.Contains(out, "folderlink run") {
			return Check{"Bridge process", CheckOK, "the bridge is running"}
		}
		return Check{"Bridge process", CheckFail, "the bridge is not running — run folderlink install"}
	}
}

func checkServerReachable(server string) Check {
	if server == "" {
		return Check{"Server", CheckFail, "no server configured"}
	}
	status, err := httpGet(server)
	if err != nil {
		return Check{"Server", CheckFail, "cannot reach " + server + ": " + err.Error()}
	}
	return Check{"Server", CheckOK, fmt.Sprintf("%s answered (HTTP %d)", server, status)}
}

func checkPairing(pairState func(context.Context) (string, error)) Check {
	if pairState == nil {
		return Check{"Pairing", CheckSkip, "not checked"}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	state, err := pairState(ctx)
	if err != nil {
		return Check{"Pairing", CheckFail, "could not ask the server: " + err.Error()}
	}
	switch state {
	case "active":
		return Check{"Pairing", CheckOK, "this computer is paired"}
	case "absent":
		return Check{"Pairing", CheckFail, "not paired — open the dashboard and pair this computer"}
	case "revoked":
		return Check{"Pairing", CheckFail, "pairing was revoked — pair this computer again"}
	default:
		return Check{"Pairing", CheckFail, "pairing state is " + state}
	}
}

func checkLastConnected(homeDir string) Check {
	if homeDir == "" {
		return Check{"Last connected", CheckSkip, "no config directory"}
	}
	raw, err := os.ReadFile(filepath.Join(homeDir, client.LastConnectedName))
	if err != nil {
		if os.IsNotExist(err) {
			return Check{"Last connected", CheckSkip, "never connected yet"}
		}
		return Check{"Last connected", CheckFail, "cannot read: " + err.Error()}
	}
	ts, err := time.Parse(time.RFC3339, strings.TrimSpace(string(raw)))
	if err != nil {
		return Check{"Last connected", CheckFail, "timestamp is not valid"}
	}
	return Check{"Last connected", CheckOK, "last connected " + ts.Format("2006-01-02 15:04") + " (" + time.Since(ts).Round(time.Minute).String() + " ago)"}
}
