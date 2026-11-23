//go:build !windows && !darwin

package pick

import (
	"context"
	"os/exec"
	"strings"
)

func openNative(ctx context.Context) (string, error) {
	cmd := exec.CommandContext(ctx, "zenity", "--file-selection", "--directory")
	out, err := cmd.Output()
	path := strings.TrimSpace(string(out))
	if path == "" {
		return "", ErrCancelled
	}
	if err != nil && path == "" {
		return "", err
	}
	return path, nil
}
