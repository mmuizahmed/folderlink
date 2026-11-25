package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/mmuizahmed/folderlink/apps/bridge/internal/config"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/service"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/update"
)

// runUpdate is `folderlink update`: check GitHub for a newer release,
// download and verify it, and replace the installed binary. With
// --rollback it puts the previous binary back instead. With --check it
// only reports whether an update is available.
//
// The update command is a separate console process from the background
// bridge, so it can stop the bridge, swap the binary, and start it again
// directly. The background bridge itself never swaps its own binary: on
// Windows a running exe is locked, so it stages the new binary and hands
// the swap to a helper (see update.ApplyWindows).
func runUpdate(cfg config.File, rest []string) error {
	rollback := false
	checkOnly := false
	for _, arg := range rest {
		switch arg {
		case "--rollback":
			rollback = true
		case "--check":
			checkOnly = true
		default:
			return errors.New("usage: folderlink update [--check|--rollback]")
		}
	}
	if rollback && checkOnly {
		return errors.New("usage: folderlink update [--check|--rollback]")
	}
	_ = cfg
	if rollback {
		return runRollback()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	rel, err := update.Check(ctx, update.DefaultClient(), version)
	if err != nil {
		return fmt.Errorf("could not check for updates: %w", err)
	}
	if rel == nil {
		fmt.Printf("FolderLink %s is up to date.\n", version)
		return nil
	}
	fmt.Printf("FolderLink %s is available (you have %s).\n", rel.Tag, version)
	if checkOnly {
		return nil
	}
	binaries, err := update.Fetch(ctx, update.DefaultClient(), rel)
	if err != nil {
		return fmt.Errorf("could not download the update: %w", err)
	}
	installed, err := service.Installed()
	if err != nil {
		return err
	}
	if installed {
		return applyToInstallDir(binaries, rel.Tag)
	}
	return applyToCurrentDir(binaries, rel.Tag)
}

func runRollback() error {
	installed, err := service.Installed()
	if err != nil {
		return err
	}
	if !installed {
		return errors.New("FolderLink is not installed as a background program; nothing to roll back")
	}
	dir, err := service.InstallDir()
	if err != nil {
		return err
	}
	if !update.HasRollback(dir) {
		return errors.New("no previous version is kept to roll back to")
	}
	_ = service.Stop()
	if err := update.Rollback(dir); err != nil {
		return err
	}
	if err := service.Start(); err != nil {
		return fmt.Errorf("rolled back, but the bridge could not be started: %w", err)
	}
	fmt.Println("Rolled back to the previous version.")
	return nil
}

func applyToInstallDir(binaries map[string][]byte, tag string) error {
	dir, err := service.InstallDir()
	if err != nil {
		return err
	}
	staged, err := update.Stage(dir, binaries)
	if err != nil {
		return err
	}
	_ = service.Stop()
	// Give the bridge a moment to exit so its exe is unlocked on Windows.
	time.Sleep(2 * time.Second)
	if err := update.Swap(dir, staged); err != nil {
		return fmt.Errorf("could not replace the installed binary: %w", err)
	}
	if err := service.Start(); err != nil {
		return fmt.Errorf("updated to %s, but the bridge could not be started: %w", tag, err)
	}
	fmt.Printf("Updated to FolderLink %s. The previous version is kept for rollback.\n", tag)
	return nil
}

func applyToCurrentDir(binaries map[string][]byte, tag string) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	dir := filepath.Dir(self)
	if runtime.GOOS == "windows" {
		// The running exe is locked, so stage the new binary next to it
		// and tell the user to swap it by hand (or run folderlink install).
		staged, err := update.Stage(dir, binaries)
		if err != nil {
			return err
		}
		var names []string
		for name, path := range staged {
			names = append(names, fmt.Sprintf("%s (staged at %s)", name, path))
		}
		fmt.Printf("FolderLink %s is staged: %s.\n", tag, strings.Join(names, ", "))
		fmt.Println("Close this window, replace the old binary with the staged one, and run folderlink install.")
		return nil
	}
	staged, err := update.Stage(dir, binaries)
	if err != nil {
		return err
	}
	if err := update.Swap(dir, staged); err != nil {
		return fmt.Errorf("could not replace the binary: %w", err)
	}
	fmt.Printf("Updated to FolderLink %s. Restart FolderLink to use it.\n", tag)
	return nil
}
