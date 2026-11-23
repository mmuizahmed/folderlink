//go:build windows

package pick

import (
	"context"
	"os/exec"
	"strings"
)

func openNative(ctx context.Context) (string, error) {
	script := `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Choose a folder FolderLink may read"
if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 2 }
Write-Output $dialog.SelectedPath
`
	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-STA", "-Command", script)
	out, err := cmd.Output()
	if cmd.ProcessState != nil && cmd.ProcessState.ExitCode() == 2 {
		return "", ErrCancelled
	}
	path := strings.TrimSpace(string(out))
	if path == "" {
		if err != nil {
			return "", err
		}
		return "", ErrCancelled
	}
	return path, nil
}
