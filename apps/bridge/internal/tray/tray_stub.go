//go:build !windows

package tray

import (
	"context"
	"log/slog"
)

// Run is the no-tray fallback for builds without a system tray (macOS and
// Linux release builds, which are built with CGO_ENABLED=0 — see tray.go).
// It blocks until ctx ends so the bridge keeps running headless.
func Run(ctx context.Context, _ Options) {
	slog.Info("system tray is not in this build; running headless")
	<-ctx.Done()
}

// Quit is a no-op without a tray: Run returns when ctx ends.
func Quit() {}
