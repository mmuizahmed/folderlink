// Package config stores the server URL and the folders this bridge may read.
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/guard"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/identity"
)

const (
	DefaultServer = "https://folderlink.muiz.pk"
	DefaultName   = "laptop"
)

var labelPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$`)

// Folder is one allowlisted directory. Path stays on this computer.
type Folder struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Path  string `json:"path"`
}

// File is the on-disk configuration.
type File struct {
	Server  string   `json:"server"`
	Web     string   `json:"web"`
	Name    string   `json:"name"`
	Folders []Folder `json:"folders"`
	// AutoUpdate is nil when the user never set it, which means on.
	// A pointer is used so an existing config file without this field
	// does not silently turn updates off.
	AutoUpdate *bool `json:"auto_update,omitempty"`
	// NotifySuccess shows a toast for every successful read. Off by
	// default: reads are frequent, and a toast per read is spam.
	NotifySuccess bool `json:"notify_success,omitempty"`
	// WriteApprovalMode is the cached write approval mode ("ai" or
	// "manual"), synced from the worker over the websocket. Empty means
	// never synced: the bridge fails closed to manual. The worker (D1)
	// is the source of truth; this is only a cache.
	WriteApprovalMode string `json:"write_approval_mode,omitempty"`
}

// AutoUpdateEnabled reports whether automatic updates are on: on unless
// the config or the FOLDERLINK_AUTO_UPDATE environment variable says off.
func (f File) AutoUpdateEnabled() bool {
	if env := os.Getenv("FOLDERLINK_AUTO_UPDATE"); env != "" {
		switch strings.ToLower(strings.TrimSpace(env)) {
		case "0", "off", "false", "no":
			return false
		case "1", "on", "true", "yes":
			return true
		}
	}
	return f.AutoUpdate == nil || *f.AutoUpdate
}

// Store reads and writes config.json.
type Store struct {
	mu   sync.Mutex
	path string
}

// Open prepares the config directory.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &Store{path: filepath.Join(dir, "config.json")}, nil
}

// Dir returns the config directory (the parent of config.json).
func (s *Store) Dir() string {
	return filepath.Dir(s.path)
}

// Load returns the config, creating defaults when the file is absent.
func (s *Store) Load() (File, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.load()
}

func (s *Store) load() (File, error) {
	raw, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		cfg := File{Server: DefaultServer, Name: DefaultName, Folders: []Folder{}}
		if err := s.save(cfg); err != nil {
			return File{}, err
		}
		return cfg, nil
	}
	if err != nil {
		return File{}, err
	}
	var cfg File
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return File{}, fmt.Errorf("config file is not valid")
	}
	if cfg.Folders == nil {
		cfg.Folders = []Folder{}
	}
	if cfg.Server == "" {
		cfg.Server = DefaultServer
	}
	if cfg.Name == "" {
		cfg.Name = DefaultName
	}
	return cfg, nil
}

// Save replaces the config file.
func (s *Store) Save(cfg File) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.save(cfg)
}

func (s *Store) save(cfg File) error {
	body, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(append(body, '\n')); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// Allow adds a directory. The stored path is symlink-resolved.
func (s *Store) Allow(path, label string) (Folder, error) {
	real, err := guard.ValidateRoot(path)
	if err != nil {
		return Folder{}, err
	}
	if label == "" {
		label = sanitizeLabel(filepath.Base(real))
	}
	if !labelPattern.MatchString(label) {
		return Folder{}, fmt.Errorf("label must be 1-41 letters, numbers, dots, underscores, or hyphens")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.load()
	if err != nil {
		return Folder{}, err
	}
	for _, folder := range cfg.Folders {
		if strings.EqualFold(folder.Label, label) {
			return Folder{}, fmt.Errorf("a folder named %s is already allowed", label)
		}
		if folder.Path == real {
			return Folder{}, fmt.Errorf("that folder is already allowed as %s", folder.Label)
		}
	}
	id, err := identity.NewID()
	if err != nil {
		return Folder{}, err
	}
	folder := Folder{ID: id, Label: label, Path: real}
	cfg.Folders = append(cfg.Folders, folder)
	if err := s.save(cfg); err != nil {
		return Folder{}, err
	}
	return folder, nil
}

// Rename changes the label of a folder. The path stays on this computer.
func (s *Store) Rename(id, label string) error {
	if !labelPattern.MatchString(label) {
		return fmt.Errorf("label must be 1-41 letters, numbers, dots, underscores, or hyphens")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.load()
	if err != nil {
		return err
	}
	found := false
	for i := range cfg.Folders {
		if cfg.Folders[i].ID == id {
			cfg.Folders[i].Label = label
			found = true
			continue
		}
		if strings.EqualFold(cfg.Folders[i].Label, label) {
			return fmt.Errorf("a folder named %s is already allowed", label)
		}
	}
	if !found {
		return fmt.Errorf("that folder is not on this computer")
	}
	return s.save(cfg)
}

// Remove deletes a folder by id.
func (s *Store) Remove(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.load()
	if err != nil {
		return err
	}
	next := cfg.Folders[:0]
	found := false
	for _, folder := range cfg.Folders {
		if folder.ID == id {
			found = true
			continue
		}
		next = append(next, folder)
	}
	if !found {
		return fmt.Errorf("that folder is not on this computer")
	}
	cfg.Folders = next
	return s.save(cfg)
}

// SetName stores the name shown for this computer.
func (s *Store) SetName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 60 {
		return fmt.Errorf("name must be 1 to 60 characters")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.load()
	if err != nil {
		return err
	}
	cfg.Name = name
	return s.save(cfg)
}

// SetWriteApprovalMode caches the write approval mode synced from the
// worker. It validates the value: an unknown mode is never stored.
func (s *Store) SetWriteApprovalMode(mode string) error {
	if mode != "ai" && mode != "manual" {
		return fmt.Errorf("unknown write approval mode %q", mode)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.load()
	if err != nil {
		return err
	}
	cfg.WriteApprovalMode = mode
	return s.save(cfg)
}

// SetNotifySuccess caches the notify-on-success setting from the tray.
// It re-reads the file first, like SetWriteApprovalMode: the tray holds a
// copy of the config from startup, and saving that copy would silently
// drop every folder added since the bridge started.
func (s *Store) SetNotifySuccess(on bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.load()
	if err != nil {
		return err
	}
	cfg.NotifySuccess = on
	return s.save(cfg)
}

// Unallow removes a folder by label.
func (s *Store) Unallow(label string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.load()
	if err != nil {
		return err
	}
	next := cfg.Folders[:0]
	found := false
	for _, folder := range cfg.Folders {
		if strings.EqualFold(folder.Label, label) {
			found = true
			continue
		}
		next = append(next, folder)
	}
	if !found {
		return fmt.Errorf("no folder named %s", label)
	}
	cfg.Folders = next
	return s.save(cfg)
}

func sanitizeLabel(base string) string {
	var b strings.Builder
	for _, r := range base {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '_', r == '-':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
		if b.Len() == 41 {
			break
		}
	}
	out := strings.Trim(b.String(), "-.")
	if out == "" || !labelPattern.MatchString(out) {
		return ""
	}
	return out
}
