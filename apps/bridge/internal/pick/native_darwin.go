//go:build darwin

package pick

import (
	"context"
	"os/exec"
	"strings"
)

func openNative(ctx context.Context) (string, error) {
	cmd := exec.CommandContext(ctx, "osascript", "-e", "POSIX path of (choose folder)")
	out, err := cmd.Output()
	path := strings.TrimSpace(string(out))
	if path == "" {
		return "", ErrCanceled
	}
	if err != nil && path == "" {
		return "", err
	}
	return path, nil
}
