package tools

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mmuizahmed/folderlink/apps/bridge/internal/config"
)

func TestDispatchNewReadTools(t *testing.T) {
	dir := t.TempDir()
	project := filepath.Join(t.TempDir(), "proj")
	if err := os.MkdirAll(filepath.Join(project, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "src", "main.go"), []byte("package main\n\n// hello world\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "shot.png"), []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := config.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	folder, err := store.Allow(project, "notes")
	if err != nil {
		t.Fatal(err)
	}
	deps := testDeps()
	ctx := context.Background()

	listed := call(t, ctx, store, deps, map[string]any{"op": "list_folders"})
	if !strings.Contains(listed, `"label":"notes"`) || !strings.Contains(listed, folder.ID) {
		t.Fatalf("list_folders did not return the folder: %s", listed)
	}

	found := call(t, ctx, store, deps, map[string]any{
		"op": "search_files", "folderId": folder.ID, "query": "hello",
	})
	if !strings.Contains(found, "src/main.go") || !strings.Contains(found, `"line":3`) {
		t.Fatalf("search_files missed the match: %s", found)
	}
	denied := call(t, ctx, store, deps, map[string]any{
		"op": "search_files", "folderId": folder.ID, "query": "hello", "path": "../outside",
	})
	if strings.Contains(denied, `"ok":true`) {
		t.Fatalf("search_files escaped the folder: %s", denied)
	}

	media := call(t, ctx, store, deps, map[string]any{
		"op": "read_media", "folderId": folder.ID, "path": "shot.png",
	})
	if !strings.Contains(media, `"mimeType":"image/png"`) {
		t.Fatalf("read_media did not return the png: %s", media)
	}

	info := call(t, ctx, store, deps, map[string]any{
		"op": "file_info", "folderId": folder.ID, "path": "src/main.go",
	})
	if !strings.Contains(info, `"name":"main.go"`) || !strings.Contains(info, `"kind":"file"`) {
		t.Fatalf("file_info was wrong: %s", info)
	}

	unknown := call(t, ctx, store, deps, map[string]any{"op": "search_files", "folderId": folder.ID})
	if strings.Contains(unknown, `"ok":true`) {
		t.Fatalf("search_files accepted an empty query: %s", unknown)
	}
}
