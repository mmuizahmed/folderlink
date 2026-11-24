//go:build windows

package update

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// ApplyWindows hands the swap to a helper PowerShell process and returns.
// The helper waits for pid to exit, moves each staged binary into place
// (keeping the old one as .old), and starts the FolderLink login task, so
// the bridge comes back as the new version. The caller must exit promptly
// after ApplyWindows returns, or the helper waits forever.
//
// The helper is a script the bridge writes itself (never downloaded), run
// hidden, and removed by the helper when it finishes.
func ApplyWindows(staged map[string]string, pid int) error {
	if len(staged) == 0 {
		return fmt.Errorf("nothing to apply")
	}
	var moves strings.Builder
	for name, stagedPath := range staged {
		dir := filepath.Dir(stagedPath)
		target := filepath.Join(dir, name)
		old := target + ".old"
		fmt.Fprintf(&moves, "Remove-Item -Force '%s' -ErrorAction SilentlyContinue\n",
			psQuote(old))
		fmt.Fprintf(&moves, "Move-Item -Force '%s' '%s'\n", psQuote(target), psQuote(old))
		fmt.Fprintf(&moves, "Move-Item -Force '%s' '%s'\n", psQuote(stagedPath), psQuote(target))
	}
	script := "Wait-Process -Id " + strconv.Itoa(pid) + " -ErrorAction SilentlyContinue\n" +
		moves.String() +
		"schtasks /run /tn FolderLink\n"
	tmp, err := os.CreateTemp("", "folderlink-update-*.ps1")
	if err != nil {
		return err
	}
	if _, err := tmp.WriteString(script); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	cmd := exec.Command("powershell.exe", "-NoProfile", "-WindowStyle", "Hidden",
		"-ExecutionPolicy", "Bypass", "-File", tmp.Name())
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := cmd.Start(); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	return nil
}

func psQuote(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}
