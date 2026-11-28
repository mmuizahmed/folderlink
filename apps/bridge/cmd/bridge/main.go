package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/mmuizahmed/folderlink/apps/bridge/internal/client"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/config"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/identity"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/pair"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/service"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/update"
)

var version = "0.1.0"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "folderlink: %s\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	fs := flag.NewFlagSet("folderlink", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	serverFlag := fs.String("server", "", "worker base URL, for example http://127.0.0.1:8787")
	webFlag := fs.String("web", "", "control panel URL")
	homeFlag := fs.String("home", "", "config directory (default: FOLDERLINK_HOME or the user config dir)")
	labelFlag := fs.String("label", "", "folder label")
	trayFlag := fs.Bool("tray", false, "show the system tray icon while running")
	cmd, rest := splitCommand(args)
	if err := fs.Parse(orderFlagsFirst(rest)); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	rest = fs.Args()
	if cmd == "version" || cmd == "--version" {
		fmt.Println(version)
		return nil
	}
	// Whether the process was launched with no command at all. A shortcut
	// double-click runs the binary with no arguments (and splitCommand
	// defaults it to "run"); the logon task and a terminal both pass an
	// explicit "run". The tray uses it to show a startup toast only for
	// a shortcut launch, not at every login.
	launchedWithoutArgs := len(args) == 0
	dir, err := homeDir(*homeFlag)
	if err != nil {
		return err
	}
	id, err := identity.LoadOrCreate(dir)
	if err != nil {
		return err
	}
	store, err := config.Open(dir)
	if err != nil {
		return err
	}
	cfg, err := store.Load()
	if err != nil {
		return err
	}
	if *serverFlag != "" {
		cfg.Server = *serverFlag
	}
	if *webFlag != "" {
		cfg.Web = *webFlag
	}
	if cfg.Web == "" {
		cfg.Web = defaultWeb(cfg.Server)
	}
	if err := client.ValidateServer(cfg.Server); err != nil {
		return err
	}
	if err := store.Save(cfg); err != nil {
		return err
	}

	switch cmd {
	case "run":
		if len(rest) != 0 {
			return errors.New("run does not take arguments")
		}
		return runBridge(id, store, cfg, *trayFlag || isBackgroundBinary(), launchedWithoutArgs)
	case "start":
		if len(rest) != 0 {
			return errors.New("start does not take arguments")
		}
		if err := service.Start(); err != nil {
			if service.IsAlreadyRunning(err) {
				fmt.Println("FolderLink is already running.")
				return nil
			}
			return err
		}
		fmt.Println("FolderLink is starting.")
		return nil
	case "allow":
		if len(rest) != 1 {
			return errors.New("usage: folderlink allow <directory>")
		}
		folder, err := store.Allow(rest[0], *labelFlag)
		if err != nil {
			return err
		}
		fmt.Printf("%s\t%s\t%s\n", folder.Label, folder.ID, folder.Path)
		return nil
	case "unallow":
		target := *labelFlag
		if target == "" && len(rest) == 1 {
			target = rest[0]
		}
		if target == "" || len(rest) > 1 {
			return errors.New("usage: folderlink unallow <label>")
		}
		return store.Unallow(target)
	case "folders":
		for _, folder := range cfg.Folders {
			fmt.Printf("%s\t%s\t%s\n", folder.Label, folder.ID, folder.Path)
		}
		return nil
	case "status":
		fmt.Printf("version\t%s\n", version)
		fmt.Printf("device\t%s\n", id.DeviceID)
		fmt.Printf("server\t%s\n", cfg.Server)
		fmt.Printf("web\t%s\n", cfg.Web)
		fmt.Printf("folders\t%d\n", len(cfg.Folders))
		installed, err := service.Installed()
		if err != nil {
			fmt.Printf("background\tunknown (%s)\n", err)
		} else if installed {
			fmt.Println("background\tinstalled")
		} else {
			fmt.Println("background\tnot installed")
		}
		return nil
	case "install":
		if len(rest) != 0 {
			return errors.New("install does not take arguments")
		}
		if err := service.Install(); err != nil {
			return err
		}
		dir, err := service.InstallDir()
		if err != nil || dir == "" {
			fmt.Println("FolderLink will start automatically when you log in.")
			return nil
		}
		if runtime.GOOS == "windows" {
			fmt.Printf("Installed to %s. FolderLink starts at login and shows a tray icon.\n", dir)
		} else {
			fmt.Printf("Installed to %s. FolderLink starts at login with no terminal.\n", dir)
		}
		return nil
	case "doctor":
		fix := false
		if len(rest) == 1 && rest[0] == "--fix" {
			fix = true
		} else if len(rest) != 0 {
			return errors.New("doctor takes no arguments except --fix")
		}
		if fix {
			if err := service.RepairLogonPower(); err != nil {
				return err
			}
			fmt.Println("Repaired: the login task will now start on battery power too.")
		}
		pairState := func(ctx context.Context) (string, error) {
			st, err := pair.Client{BaseURL: cfg.Server}.Status(ctx, id)
			if err != nil {
				return "", err
			}
			return st.State, nil
		}
		checks := service.Doctor(service.DoctorConfig{
			Server:    cfg.Server,
			HomeDir:   store.Dir(),
			PairState: pairState,
		})
		problems := 0
		for _, c := range checks {
			fmt.Printf("[%s] %s: %s\n", c.Status, c.Name, c.Detail)
			if c.Status == service.CheckFail {
				problems++
			}
		}
		if problems == 0 {
			fmt.Println("Everything looks good.")
		} else {
			fmt.Printf("%d problem(s) found.\n", problems)
		}
		return nil
	case "update":
		return runUpdate(cfg, rest)
	case "uninstall":
		if len(rest) != 0 {
			return errors.New("uninstall does not take arguments")
		}
		if err := service.Uninstall(); err != nil {
			return err
		}
		fmt.Println("FolderLink will no longer start automatically.")
		return nil
	default:
		return fmt.Errorf("unknown command %q", cmd)
	}
}

func runBridge(id *identity.Identity, store *config.Store, cfg config.File, trayMode bool, launchedWithoutArgs bool) error {
	if trayMode {
		return runTrayBridge(id, store, cfg, launchedWithoutArgs)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))
	fmt.Println("FolderLink is running.")
	fmt.Println("Leave this window open. An AI app can read a folder only while this window stays open.")
	fmt.Println("The first time, your browser opens so you can connect this computer.")
	// A console run never applies an update by itself: the user is here,
	// so tell them one is available instead.
	go func() {
		checkCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		rel, err := update.Check(checkCtx, update.DefaultClient(), version)
		if err != nil || rel == nil {
			return
		}
		fmt.Printf("FolderLink %s is available (you have %s). Run `folderlink update` to install it.\n", rel.Tag, version)
	}()
	return client.Run(ctx, clientConfig(id, store, cfg))
}

// clientConfig builds the client configuration shared by the console run
// and the tray run.
func clientConfig(id *identity.Identity, store *config.Store, cfg config.File) client.Config {
	return client.Config{
		Server:   cfg.Server,
		Web:      cfg.Web,
		Name:     deviceName(cfg.Name),
		Version:  version,
		Identity: id,
		Store:    store,
		Pair:     pair.Client{BaseURL: cfg.Server},
		StateDir: store.Dir(),
	}
}

func splitCommand(args []string) (string, []string) {
	known := map[string]bool{
		"run": true, "allow": true, "unallow": true, "folders": true, "status": true, "version": true,
		"install": true, "uninstall": true, "doctor": true, "update": true, "start": true,
	}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			break
		}
		if strings.HasPrefix(arg, "-") {
			if !strings.Contains(arg, "=") && flagTakesValue(arg) {
				i++
			}
			continue
		}
		if known[arg] {
			out := make([]string, 0, len(args)-1)
			out = append(out, args[:i]...)
			out = append(out, args[i+1:]...)
			return arg, out
		}
	}
	return "run", args
}

func orderFlagsFirst(args []string) []string {
	var flags []string
	var positional []string
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			positional = append(positional, args[i+1:]...)
			break
		}
		if strings.HasPrefix(arg, "-") {
			flags = append(flags, arg)
			if !strings.Contains(arg, "=") && flagTakesValue(arg) && i+1 < len(args) {
				i++
				flags = append(flags, args[i])
			}
			continue
		}
		positional = append(positional, arg)
	}
	return append(flags, positional...)
}

func flagTakesValue(arg string) bool {
	name := strings.TrimLeft(arg, "-")
	switch name {
	case "server", "web", "home", "label":
		return true
	default:
		return false
	}
}

func homeDir(flagValue string) (string, error) {
	if flagValue != "" {
		return flagValue, nil
	}
	if env := os.Getenv("FOLDERLINK_HOME"); env != "" {
		return env, nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "folderlink"), nil
}

func defaultWeb(server string) string {
	lower := strings.ToLower(server)
	if strings.Contains(lower, "localhost") || strings.Contains(lower, "127.0.0.1") || strings.Contains(lower, "[::1]") {
		return "http://localhost:5173"
	}
	return "https://folderlink.muiz.pk"
}

func deviceName(configured string) string {
	name := configured
	if name == "" || name == config.DefaultName {
		if host, err := os.Hostname(); err == nil && host != "" {
			name = host
		}
	}
	name = strings.TrimSpace(name)
	if len(name) > 60 {
		name = name[:60]
	}
	if name == "" {
		return config.DefaultName
	}
	return name
}
