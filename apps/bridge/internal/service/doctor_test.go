package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// stubCommands replaces the command runners with canned outputs for one test.
func stubCommands(t *testing.T, outputs map[string]string, errs map[string]error) {
	t.Helper()
	oldRun, oldOut, oldGet := run, runOutput, httpGet
	run = func(name string, args ...string) error {
		if err, ok := errs[name+" "+strings.Join(args, " ")]; ok {
			return err
		}
		return nil
	}
	runOutput = func(name string, args ...string) (string, error) {
		key := name + " " + strings.Join(args, " ")
		if err, ok := errs[key]; ok {
			return outputs[key], err
		}
		return outputs[key], nil
	}
	httpGet = func(string) (int, error) { return 200, nil }
	t.Cleanup(func() { run, runOutput, httpGet = oldRun, oldOut, oldGet })
}

func findCheck(checks []Check, name string) Check {
	for _, c := range checks {
		if c.Name == name {
			return c
		}
	}
	return Check{Name: name, Status: "missing"}
}

func TestDoctorNotInstalled(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	stubCommands(t, map[string]string{}, map[string]error{
		"systemctl --user is-enabled folderlink.service": errors.New("exit status 1"),
	})
	checks := Doctor(DoctorConfig{
		Server:  "https://folderlink.muiz.pk",
		HomeDir: home,
		PairState: func(context.Context) (string, error) {
			return "absent", nil
		},
	})
	if got := findCheck(checks, "Background copy"); got.Status != CheckFail {
		t.Errorf("Background copy = %s, want FAIL", got.Status)
	}
	if got := findCheck(checks, "Background install"); got.Status != CheckFail {
		t.Errorf("Background install = %s, want FAIL", got.Status)
	}
	if got := findCheck(checks, "Login task"); got.Status != CheckSkip {
		t.Errorf("Login task = %s, want skip", got.Status)
	}
	if got := findCheck(checks, "Bridge process"); got.Status != CheckFail {
		t.Errorf("Bridge process = %s, want FAIL", got.Status)
	}
	if got := findCheck(checks, "Server"); got.Status != CheckOK {
		t.Errorf("Server = %s, want ok", got.Status)
	}
	if got := findCheck(checks, "Pairing"); got.Status != CheckFail || !strings.Contains(got.Detail, "not paired") {
		t.Errorf("Pairing = %s %q, want FAIL about not being paired", got.Status, got.Detail)
	}
	if got := findCheck(checks, "Last connected"); got.Status != CheckSkip {
		t.Errorf("Last connected = %s, want skip", got.Status)
	}
}

func TestDoctorInstalledAndRunning(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	// Fake a staged copy, a unit file pointing at it, and a last connection.
	dir, err := InstallDir()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	staged := filepath.Join(dir, "folderlink")
	if err := os.WriteFile(staged, []byte("fake"), 0o600); err != nil {
		t.Fatal(err)
	}
	unitDir := filepath.Join(home, ".config", "systemd", "user")
	if err := os.MkdirAll(unitDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(unitDir, "folderlink.service"),
		[]byte("[Service]\nExecStart="+staged+" run\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "last-connected"),
		[]byte(time.Now().UTC().Format(time.RFC3339)), 0o600); err != nil {
		t.Fatal(err)
	}
	stubCommands(t, map[string]string{
		"systemctl --user is-enabled folderlink.service": "enabled\n",
		"ps -ax -o args=": "folderlink run\nfolderlink doctor\n",
	}, map[string]error{})
	checks := Doctor(DoctorConfig{
		Server:  "https://folderlink.muiz.pk",
		HomeDir: home,
		PairState: func(context.Context) (string, error) {
			return "active", nil
		},
	})
	for _, name := range []string{"Background copy", "Background install", "Login task", "Bridge process", "Server", "Pairing", "Last connected"} {
		if got := findCheck(checks, name); got.Status != CheckOK {
			t.Errorf("%s = %s (%q), want ok", name, got.Status, got.Detail)
		}
	}
}

func TestDoctorServerUnreachable(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	oldRun, oldOut, oldGet := run, runOutput, httpGet
	run = func(string, ...string) error { return nil }
	runOutput = func(string, ...string) (string, error) { return "", errors.New("exit status 1") }
	httpGet = func(string) (int, error) { return 0, errors.New("connection refused") }
	t.Cleanup(func() { run, runOutput, httpGet = oldRun, oldOut, oldGet })
	checks := Doctor(DoctorConfig{Server: "https://folderlink.muiz.pk", HomeDir: home})
	if got := findCheck(checks, "Server"); got.Status != CheckFail || !strings.Contains(got.Detail, "connection refused") {
		t.Errorf("Server = %s %q, want FAIL about connection refused", got.Status, got.Detail)
	}
}
