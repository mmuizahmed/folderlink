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
	DefaultServer = "https://mcp.muiz.pk"
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
