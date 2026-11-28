package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"

	"github.com/mmuizahmed/folderlink/apps/bridge/internal/browser"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/client"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/config"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/identity"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/mode"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/notify"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/service"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/tray"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/update"
)

// isBackgroundBinary reports whether this process is the no-console build.
// The Windows scheduled task runs folderlink-bg.exe; the plain binary only
// shows the tray with --tray.
func isBackgroundBinary() bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	return isBackgroundBinaryName(exe)
}

// isBackgroundBinaryName is isBackgroundBinary with the executable path
// exposed, for tests.
func isBackgroundBinaryName(exe string) bool {
	base := filepath.Base(exe)
	return base == "folderlink-bg" || base == "folderlink-bg.exe"
}

// runTrayBridge runs the bridge under the system tray. The tray lives on
// the main goroutine (it needs the main thread); the bridge runs in a
// supervisor goroutine that restarts it when the user picks Restart bridge.
// Quitting from the tray stops the bridge and returns. There is no console
// window in this mode, so client output is discarded and the tray status
// line is the only UI.
func runTrayBridge(id *identity.Identity, store *config.Store, cfg config.File, launchedWithoutArgs bool) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	// Notification identity must be set before any window exists, and the
	// Start Menu shortcut must exist for Windows to deliver toasts at all.
	// Both are best effort: a missing shortcut only means silent toasts,
	// and doctor reports it.
	notify.EnsureAppIdentity()
	if err := service.EnsureToastShortcut(); err != nil {
		slog.Warn("notification shortcut is missing", "err", err.Error())
	}
	// The Desktop shortcut lets the user start FolderLink again after
	// quitting from the tray. Best effort, like the notification
	// shortcut: a missing shortcut only means no desktop icon, and
	// doctor reports it. Existing installs get it on the next start.
	if err := service.EnsureDesktopShortcut(); err != nil {
		slog.Warn("desktop shortcut is missing", "err", err.Error())
	}
	// Toasts only in tray mode: a console run already prints to the
	// terminal. Refused reads always toast; successful reads only when
	// the user opted in (tray checkbox).
	notifier := notify.New(true, cfg.NotifySuccess)
	// A second tray would fight the first for the connection and the tray
	// icon. If one is already running, tell the user and exit instead of
	// starting a duplicate bridge. A guard failure is best effort: the
	// bridge still starts.
	release, alreadyRunning, err := service.TryAcquireSingleInstance()
	if err != nil {
		slog.Warn("single-instance check failed", "err", err.Error())
	}
	if alreadyRunning {
		notifier.AlreadyRunning()
		return nil
	}
	defer release()
	clientCfg := clientConfig(id, store, cfg)
	clientCfg.Stdout = io.Discard
	clientCfg.OnState = tray.SetState
	// The tray shows the write approval mode (read-only): the mode is
	// changed in the dashboard Settings, and the worker pushes changes
	// live. There is no approve-from-tray UI: approving happens in the
	// dashboard, and the tray notification is the alert.
	clientCfg.OnMode = tray.SetMode
	clientCfg.Notify = notifier
	restart := make(chan struct{}, 1)
	checkNow := make(chan struct{}, 1)
	quit := make(chan struct{})
	var quitOnce sync.Once
	requestQuit := func() { quitOnce.Do(func() { close(quit) }) }
	var wg sync.WaitGroup
	wg.Add(1)
	runUpdateLoop(ctx, cfg, checkNow, requestQuit)
	go func() {
		defer wg.Done()
		for {
			runCtx, cancel := context.WithCancel(ctx)
			done := make(chan error, 1)
			go func() { done <- client.Run(runCtx, clientCfg) }()
			select {
			case <-quit:
				cancel()
				<-done
				return
			case <-restart:
				cancel()
				<-done
			case err := <-done:
				// The bridge normally only returns when its context is
				// canceled, so this is defensive: wait a moment, then
				// start it again instead of exiting.
				_ = err
				cancel()
				if ctx.Err() != nil {
					return
				}
				select {
				case <-quit:
					return
				case <-time.After(2 * time.Second):
				}
			case <-ctx.Done():
				cancel()
				<-done
				return
			}
		}
	}()
	tray.Run(ctx, tray.Options{
		Web:  cfg.Web,
		Mode: mode.New(cfg.WriteApprovalMode).Get(),
		OnReady: func() {
			// A shortcut double-click gives no other feedback (the
			// background binary has no console), so toast once the tray
			// is up. The logon task and a terminal run pass an explicit
			// "run", so they do not toast at every login.
			if launchedWithoutArgs {
				notifier.Started()
			}
		},
		OnRestart: func() {
			select {
			case restart <- struct{}{}:
			default:
			}
		},
		OnCheckUpdates: func() {
			select {
			case checkNow <- struct{}{}:
			default:
			}
		},
		NotifySuccess: cfg.NotifySuccess,
		OnToggleNotifySuccess: func(on bool) {
			notifier.SetNotifySuccess(on)
			tray.SetNotifySuccess(on)
			if err := store.SetNotifySuccess(on); err != nil {
				slog.Warn("could not save notification setting", "err", err.Error())
			}
		},
		OnQuit: requestQuit,
	})
	requestQuit()
	stop()
	wg.Wait()
	return nil
}

// updateCheckInterval is how often the background bridge looks for a new
// release on its own. A manual "Check for updates" from the tray checks
// immediately, whenever it is picked.
const updateCheckInterval = 6 * time.Hour

// runUpdateLoop checks GitHub for a newer release in the background. The
// first check is shortly after start, so it does not compete with pairing;
// after that it checks every updateCheckInterval. A manual check from the
// tray only offers the update (the menu item becomes "Update to ..."); the
// next pick applies it. An automatic check applies it straight away, but
// only when automatic updates are on. When automatic updates are off, the
// loop only runs on manual checks.
func runUpdateLoop(
	ctx context.Context,
	cfg config.File,
	checkNow <-chan struct{},
	requestQuit func(),
) {
	pending := make(chan *update.Release, 1)
	apply := func(rel *update.Release) {
		if rel == nil {
			return
		}
		if err := applyRelease(ctx, rel); err != nil {
			slog.Warn("update failed", "err", err.Error())
			return
		}
		// The new binary is staged (Windows) or swapped in (macOS/Linux).
		// Quit the tray and stop the bridge so the process exits and the
		// new binary starts.
		tray.Quit()
		requestQuit()
	}
	check := func(manual bool) {
		checkCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
		rel, err := update.Check(checkCtx, update.DefaultClient(), version)
		if err != nil {
			slog.Warn("update check failed", "err", err.Error())
			return
		}
		if rel == nil {
			tray.SetUpdateAvailable("")
			return
		}
		if !manual && cfg.AutoUpdateEnabled() {
			apply(rel)
			return
		}
		// Offer it: the menu item becomes "Update to ...", and the next
		// pick applies it.
		select {
		case pending <- rel:
		default:
		}
		tray.SetUpdateAvailable(rel.Tag)
	}
	go func() {
		if !cfg.AutoUpdateEnabled() {
			for {
				select {
				case <-ctx.Done():
					return
				case <-checkNow:
					select {
					case rel := <-pending:
						apply(rel)
					default:
						check(true)
					}
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
		}
		check(false)
		ticker := time.NewTicker(updateCheckInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				check(false)
			case <-checkNow:
				select {
				case rel := <-pending:
					apply(rel)
				default:
					check(true)
				}
			}
		}
	}()
}

// applyRelease downloads, verifies and stages a release, then swaps it in
// and quits so the new binary starts. It only runs when the background
// install exists: without it there is no login task to restart the bridge,
// so the user is sent to the releases page instead.
func applyRelease(ctx context.Context, rel *update.Release) error {
	installed, err := service.Installed()
	if err != nil {
		return err
	}
	if !installed {
		_ = browser.Open("https://github.com/mmuizahmed/folderlink/releases/latest")
		return fmt.Errorf("FolderLink is not installed as a background program; download the release from the browser")
	}
	dir, err := service.InstallDir()
	if err != nil {
		return err
	}
	fetchCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	binaries, err := update.Fetch(fetchCtx, update.DefaultClient(), rel)
	if err != nil {
		return fmt.Errorf("could not download the update: %w", err)
	}
	staged, err := update.Stage(dir, binaries)
	if err != nil {
		return err
	}
	if runtime.GOOS == "windows" {
		// The helper waits for this process to exit, swaps the staged
		// binaries in, and starts the login task.
		return update.ApplyWindows(staged, os.Getpid())
	}
	// On macOS and Linux the running binary can be replaced in place.
	// The LaunchAgent or systemd unit restarts it after this process exits.
	return update.Swap(dir, staged)
}
