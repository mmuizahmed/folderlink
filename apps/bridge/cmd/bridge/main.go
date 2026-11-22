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
	"strings"
	"syscall"

	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/client"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/config"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/identity"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/pair"
)

var version = "0.1.0"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "mcp-bridge: %s\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	fs := flag.NewFlagSet("mcp-bridge", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	serverFlag := fs.String("server", "", "worker base URL, for example http://127.0.0.1:8787")
	webFlag := fs.String("web", "", "control panel URL")
	homeFlag := fs.String("home", "", "config directory (default: MCP_BRIDGE_HOME or the user config dir)")
	labelFlag := fs.String("label", "", "folder label")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	cmd := "run"
	rest := fs.Args()
	if len(rest) > 0 {
		cmd = rest[0]
		rest = rest[1:]
	}
	if cmd == "version" || cmd == "--version" {
		fmt.Println(version)
		return nil
	}
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
		return runBridge(id, store, cfg)
	case "allow":
		if len(rest) != 1 {
			return errors.New("usage: mcp-bridge allow <directory>")
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
			return errors.New("usage: mcp-bridge unallow <label>")
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
		return nil
	default:
		return fmt.Errorf("unknown command %q", cmd)
	}
}

func runBridge(id *identity.Identity, store *config.Store, cfg config.File) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))
	fmt.Printf("mcp-bridge %s\n", version)
	fmt.Printf("server: %s\n", cfg.Server)
	return client.Run(ctx, client.Config{
		Server:   cfg.Server,
		Web:      cfg.Web,
		Name:     deviceName(cfg.Name),
		Version:  version,
		Identity: id,
		Store:    store,
		Pair:     pair.Client{BaseURL: cfg.Server},
	})
}

func homeDir(flagValue string) (string, error) {
	if flagValue != "" {
		return flagValue, nil
	}
	if env := os.Getenv("MCP_BRIDGE_HOME"); env != "" {
		return env, nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "mcp-bridge"), nil
}

func defaultWeb(server string) string {
	lower := strings.ToLower(server)
	if strings.Contains(lower, "localhost") || strings.Contains(lower, "127.0.0.1") || strings.Contains(lower, "[::1]") {
		return "http://localhost:5173"
	}
	return "https://mcp.muiz.pk"
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
