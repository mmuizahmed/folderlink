package tools

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/approve"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/config"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/execrun"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/mode"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/pick"
)

func TestDispatchReadsOnlyTheAllowlist(t *testing.T) {
	dir := t.TempDir()
	project := filepath.Join(t.TempDir(), "proj")
	outside := filepath.Join(filepath.Dir(project), "proj-evil")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	const secret = "OUTSIDESECRET"
	if err := os.WriteFile(filepath.Join(project, "hello.txt"), []byte("hello from the bridge"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, ".env"), []byte(secret), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "x.txt"), []byte(secret), 0o600); err != nil {
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

	body := call(t, ctx, store, deps, map[string]any{"op": "read_file", "folderId": folder.ID, "path": "hello.txt"})
	if !strings.Contains(body, "hello from the bridge") {
		t.Fatal(body)
	}

	for _, path := range []string{".env", "../proj-evil/x.txt", "hello.txt/../../../../etc/passwd"} {
		denied := call(t, ctx, store, deps, map[string]any{"op": "read_file", "folderId": folder.ID, "path": path})
		if strings.Contains(denied, secret) || strings.Contains(denied, `"ok":true`) {
			t.Fatalf("path %s leaked or succeeded: %s", path, denied)
		}
	}

	unknown := call(t, ctx, store, deps, map[string]any{
		"op":       "read_file",
		"folderId": "00000000-0000-4000-8000-000000000000",
		"path":     "hello.txt",
		"deviceId": "client-supplied",
	})
	if strings.Contains(unknown, "hello from the bridge") || strings.Contains(unknown, "client-supplied") {
		t.Fatal(unknown)
	}

	unsupported := call(t, ctx, store, deps, map[string]any{"op": "exec", "folderId": folder.ID, "path": "hello.txt"})
	if !strings.Contains(unsupported, "not supported") {
		t.Fatal(unsupported)
	}
}

func TestPickFolderUsesTheInjectedDialog(t *testing.T) {
	home := t.TempDir()
	chosen := t.TempDir()
	store, err := config.Open(home)
	if err != nil {
		t.Fatal(err)
	}
	deps := testDeps()
	previous := pick.Open
	pick.Open = func(context.Context) (string, error) { return chosen, nil }
	t.Cleanup(func() { pick.Open = previous })
	body := call(t, context.Background(), store, deps, map[string]any{"op": "pick_folder"})
	if !strings.Contains(body, `"ok":true`) || !strings.Contains(body, filepath.Base(chosen)) {
		t.Fatal(body)
	}
	canceled := pick.ErrCanceled
	pick.Open = func(context.Context) (string, error) { return "", canceled }
	denied := call(t, context.Background(), store, deps, map[string]any{"op": "pick_folder"})
	if !strings.Contains(denied, "canceled") {
		t.Fatal(denied)
	}
}

func call(t *testing.T, ctx context.Context, store *config.Store, deps Deps, payload map[string]any) string {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(Dispatch(ctx, store, deps, raw))
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

func testDeps() Deps {
	return Deps{
		Approve:      approve.New(),
		Exec:         execrun.NewRegistry(),
		Mode:         mode.New("ai"),
		DashboardURL: "https://folderlink.muiz.pk",
	}
}
