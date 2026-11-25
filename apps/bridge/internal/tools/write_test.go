package tools

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/config"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/mode"
)

type envelope struct {
	OK    bool `json:"ok"`
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
	Result json.RawMessage `json:"result"`
}

type approvalResult struct {
	Status       string   `json:"status"`
	RequestID    string   `json:"requestId"`
	Operation    string   `json:"operation"`
	DashboardURL string   `json:"dashboardUrl"`
	Diff         string   `json:"diff"`
	Preview      string   `json:"preview"`
	Argv         []string `json:"argv"`
}

func callJSON(t *testing.T, ctx context.Context, store *config.Store, deps Deps, payload map[string]any) envelope {
	t.Helper()
	var out envelope
	if err := json.Unmarshal([]byte(call(t, ctx, store, deps, payload)), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func setupFolder(t *testing.T) (*config.Store, string, Deps) {
	t.Helper()
	project := filepath.Join(t.TempDir(), "proj")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	store, err := config.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	folder, err := store.Allow(project, "notes")
	if err != nil {
		t.Fatal(err)
	}
	return store, folder.ID, testDeps()
}

func TestWriteFilePlainTextNeedsApproval(t *testing.T) {
	store, folderID, deps := setupFolder(t)
	ctx := context.Background()
	// Every write needs a dashboard approval now, even a plain-text one
	// in AI mode: no write lands on a client card alone.
	out := callJSON(t, ctx, store, deps, map[string]any{
		"op": "write_file", "folderId": folderID, "path": "a.md", "content": "hello\n",
	})
	if !out.OK {
		t.Fatalf("first call failed: %+v", out.Error)
	}
	var approval approvalResult
	if err := json.Unmarshal(out.Result, &approval); err != nil {
		t.Fatal(err)
	}
	if approval.Status != "approval_required" || approval.RequestID == "" {
		t.Fatalf("result = %+v, want approval_required", approval)
	}
	if out := callJSON(t, ctx, store, deps, map[string]any{
		"op": "approve_request", "requestId": approval.RequestID,
	}); !out.OK {
		t.Fatalf("approve_request failed: %+v", out.Error)
	}
	done := callJSON(t, ctx, store, deps, map[string]any{
		"op": "write_file", "folderId": folderID, "path": "a.md",
		"content": "hello\n", "approvalId": approval.RequestID,
	})
	if !done.OK {
		t.Fatalf("second call failed: %+v", done.Error)
	}
	var res struct {
		PreHash  string `json:"preHash"`
		PostHash string `json:"postHash"`
		Bytes    int    `json:"bytes"`
	}
	if err := json.Unmarshal(done.Result, &res); err != nil {
		t.Fatal(err)
	}
	if res.PreHash != "absent" || res.Bytes != 6 || res.PostHash == "" {
		t.Fatalf("result = %+v", res)
	}
}

func TestWriteFileTSXNeedsApproval(t *testing.T) {
	store, folderID, deps := setupFolder(t)
	ctx := context.Background()
	// A plain .tsx or .css write in AI mode needs approval too — the
	// file type no longer decides.
	for _, path := range []string{"ui.tsx", "styles.css"} {
		out := callJSON(t, ctx, store, deps, map[string]any{
			"op": "write_file", "folderId": folderID, "path": path, "content": "x\n",
		})
		if !out.OK {
			t.Fatalf("first call failed: %+v", out.Error)
		}
		var approval approvalResult
		if err := json.Unmarshal(out.Result, &approval); err != nil {
			t.Fatal(err)
		}
		if approval.Status != "approval_required" || approval.RequestID == "" {
			t.Fatalf("write %s = %+v, want approval_required", path, approval)
		}
	}
}

func TestWriteFileScriptNeedsApproval(t *testing.T) {
	store, folderID, deps := setupFolder(t)
	ctx := context.Background()
	// First call: approval_required, with the diff and dashboard link.
	out := callJSON(t, ctx, store, deps, map[string]any{
		"op": "write_file", "folderId": folderID, "path": "run.ps1", "content": "Write-Host hi\n",
	})
	if !out.OK {
		t.Fatalf("first call failed: %+v", out.Error)
	}
	var approval approvalResult
	if err := json.Unmarshal(out.Result, &approval); err != nil {
		t.Fatal(err)
	}
	if approval.Status != "approval_required" || approval.RequestID == "" {
		t.Fatalf("result = %+v", approval)
	}
	if !strings.Contains(approval.DashboardURL, "folderlink.muiz.pk/dashboard#approvals/") {
		t.Fatalf("dashboardUrl = %q", approval.DashboardURL)
	}
	if !strings.Contains(approval.Diff, "+Write-Host hi") {
		t.Fatalf("diff = %q", approval.Diff)
	}
	// Second call before approval: still pending, not an error.
	again := callJSON(t, ctx, store, deps, map[string]any{
		"op": "write_file", "folderId": folderID, "path": "run.ps1",
		"content": "Write-Host hi\n", "approvalId": approval.RequestID,
	})
	if !again.OK {
		t.Fatalf("second call before approval failed: %+v", again.Error)
	}
	var pending approvalResult
	if err := json.Unmarshal(again.Result, &pending); err != nil {
		t.Fatal(err)
	}
	if pending.Status != "approval_required" {
		t.Fatalf("second call before approval = %+v", pending)
	}
	// The dashboard approves (via the worker, over the websocket).
	approved := callJSON(t, ctx, store, deps, map[string]any{
		"op": "approve_request", "requestId": approval.RequestID,
	})
	if !approved.OK {
		t.Fatalf("approve_request failed: %+v", approved.Error)
	}
	// Second call after approval: the write executes.
	done := callJSON(t, ctx, store, deps, map[string]any{
		"op": "write_file", "folderId": folderID, "path": "run.ps1",
		"content": "Write-Host hi\n", "approvalId": approval.RequestID,
	})
	if !done.OK {
		t.Fatalf("second call after approval failed: %+v", done.Error)
	}
	// Single-use: the same id cannot write again.
	replay := callJSON(t, ctx, store, deps, map[string]any{
		"op": "write_file", "folderId": folderID, "path": "run.ps1",
		"content": "Write-Host hi\n", "approvalId": approval.RequestID,
	})
	if replay.OK || replay.Error.Code != "approval_denied" {
		t.Fatalf("replay = %+v, want approval_denied", replay.Error)
	}
}

func TestWriteFileDeny(t *testing.T) {
	store, folderID, deps := setupFolder(t)
	ctx := context.Background()
	out := callJSON(t, ctx, store, deps, map[string]any{
		"op": "write_file", "folderId": folderID, "path": "x.sh", "content": "#!/bin/sh\n",
	})
	var approval approvalResult
	if err := json.Unmarshal(out.Result, &approval); err != nil {
		t.Fatal(err)
	}
	denied := callJSON(t, ctx, store, deps, map[string]any{
		"op": "deny_request", "requestId": approval.RequestID,
	})
	if !denied.OK {
		t.Fatalf("deny_request failed: %+v", denied.Error)
	}
	second := callJSON(t, ctx, store, deps, map[string]any{
		"op": "write_file", "folderId": folderID, "path": "x.sh",
		"content": "#!/bin/sh\n", "approvalId": approval.RequestID,
	})
	if second.OK || second.Error.Code != "approval_denied" {
		t.Fatalf("second call after deny = %+v, want approval_denied", second.Error)
	}
}

func TestWriteFileTamperFails(t *testing.T) {
	store, folderID, deps := setupFolder(t)
	ctx := context.Background()
	project := ""
	// Find the folder path through the store to tamper with the file.
	cfg, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range cfg.Folders {
		if f.ID == folderID {
			project = f.Path
		}
	}
	if err := os.WriteFile(filepath.Join(project, "s.py"), []byte("print(1)\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	out := callJSON(t, ctx, store, deps, map[string]any{
		"op": "write_file", "folderId": folderID, "path": "s.py", "content": "print(2)\n",
	})
	var approval approvalResult
	if err := json.Unmarshal(out.Result, &approval); err != nil {
		t.Fatal(err)
	}
	if approval.Status != "approval_required" {
		t.Fatalf("expected approval_required, got %+v", approval)
	}
	if out := callJSON(t, ctx, store, deps, map[string]any{
		"op": "approve_request", "requestId": approval.RequestID,
	}); !out.OK {
		t.Fatalf("approve_request failed: %+v", out.Error)
	}
	// The file changes after approval: the second call must refuse.
	if err := os.WriteFile(filepath.Join(project, "s.py"), []byte("print(3)\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	second := callJSON(t, ctx, store, deps, map[string]any{
		"op": "write_file", "folderId": folderID, "path": "s.py",
		"content": "print(2)\n", "approvalId": approval.RequestID,
	})
	if second.OK || second.Error.Code != "hash_mismatch" {
		t.Fatalf("second call after tamper = %+v, want hash_mismatch", second.Error)
	}
}

func TestDeleteFileTwoTurn(t *testing.T) {
	store, folderID, deps := setupFolder(t)
	ctx := context.Background()
	cfg, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	project := cfg.Folders[0].Path
	if err := os.WriteFile(filepath.Join(project, "old.txt"), []byte("line1\nline2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	out := callJSON(t, ctx, store, deps, map[string]any{
		"op": "delete_file", "folderId": folderID, "path": "old.txt",
	})
	if !out.OK {
		t.Fatalf("first call failed: %+v", out.Error)
	}
	var approval approvalResult
	if err := json.Unmarshal(out.Result, &approval); err != nil {
		t.Fatal(err)
	}
	if approval.Status != "approval_required" || !strings.Contains(approval.Preview, "line1") {
		t.Fatalf("result = %+v", approval)
	}
	if out := callJSON(t, ctx, store, deps, map[string]any{
		"op": "approve_request", "requestId": approval.RequestID,
	}); !out.OK {
		t.Fatalf("approve_request failed: %+v", out.Error)
	}
	done := callJSON(t, ctx, store, deps, map[string]any{
		"op": "delete_file", "folderId": folderID, "path": "old.txt", "approvalId": approval.RequestID,
	})
	if !done.OK {
		t.Fatalf("second call failed: %+v", done.Error)
	}
	if _, err := os.Stat(filepath.Join(project, "old.txt")); !os.IsNotExist(err) {
		t.Fatal("file was not deleted")
	}
}

func TestRunCommandTwoTurn(t *testing.T) {
	store, folderID, deps := setupFolder(t)
	ctx := context.Background()
	out := callJSON(t, ctx, store, deps, map[string]any{
		"op": "run_command", "folderId": folderID, "command": "git", "args": []string{"--version"},
	})
	if !out.OK {
		t.Fatalf("first call failed: %+v", out.Error)
	}
	var approval approvalResult
	if err := json.Unmarshal(out.Result, &approval); err != nil {
		t.Fatal(err)
	}
	if approval.Status != "approval_required" || len(approval.Argv) != 2 || approval.Argv[0] != "git" {
		t.Fatalf("result = %+v", approval)
	}
	if out := callJSON(t, ctx, store, deps, map[string]any{
		"op": "approve_request", "requestId": approval.RequestID,
	}); !out.OK {
		t.Fatalf("approve_request failed: %+v", out.Error)
	}
	started := callJSON(t, ctx, store, deps, map[string]any{
		"op": "run_command", "folderId": folderID, "command": "git", "args": []string{"--version"},
		"approvalId": approval.RequestID,
	})
	if !started.OK {
		t.Fatalf("second call failed: %+v", started.Error)
	}
	var run struct {
		Status      string `json:"status"`
		ExecutionID string `json:"executionId"`
	}
	if err := json.Unmarshal(started.Result, &run); err != nil {
		t.Fatal(err)
	}
	if run.Status != "started" || run.ExecutionID == "" {
		t.Fatalf("run = %+v", run)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		polled := callJSON(t, ctx, store, deps, map[string]any{
			"op": "exec_poll", "executionId": run.ExecutionID,
		})
		if !polled.OK {
			t.Fatalf("exec_poll failed: %+v", polled.Error)
		}
		var res struct {
			Status   string `json:"status"`
			ExitCode int    `json:"exitCode"`
			Stdout   string `json:"stdout"`
		}
		if err := json.Unmarshal(polled.Result, &res); err != nil {
			t.Fatal(err)
		}
		if res.Status != "running" {
			if res.Status != "done" || res.ExitCode != 0 || !strings.Contains(res.Stdout, "git version") {
				t.Fatalf("poll result = %+v", res)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("git --version did not finish in 10s")
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestRunCommandDisallowed(t *testing.T) {
	store, folderID, deps := setupFolder(t)
	ctx := context.Background()
	out := callJSON(t, ctx, store, deps, map[string]any{
		"op": "run_command", "folderId": folderID, "command": "rm", "args": []string{"-rf", "/"},
	})
	if out.OK || out.Error.Code != "bad_request" {
		t.Fatalf("run_command rm = %+v, want bad_request", out.Error)
	}
	out = callJSON(t, ctx, store, deps, map[string]any{
		"op": "exec_poll", "executionId": "exec_nope",
	})
	if out.OK || out.Error.Code != "not_found" {
		t.Fatalf("exec_poll unknown = %+v, want not_found", out.Error)
	}
}

func TestWriteFileDeniedPaths(t *testing.T) {
	store, folderID, deps := setupFolder(t)
	ctx := context.Background()
	for _, path := range []string{".env", "../escape.txt"} {
		out := callJSON(t, ctx, store, deps, map[string]any{
			"op": "write_file", "folderId": folderID, "path": path, "content": "x",
		})
		if out.OK {
			t.Fatalf("write_file %q succeeded", path)
		}
		if out.Error.Code != "denied" && out.Error.Code != "outside_root" {
			t.Fatalf("write_file %q = %q, want denied/outside_root", path, out.Error.Code)
		}
	}
}

func TestApproveUnknownRequest(t *testing.T) {
	store, _, deps := setupFolder(t)
	ctx := context.Background()
	out := callJSON(t, ctx, store, deps, map[string]any{
		"op": "approve_request", "requestId": "00000000-0000-0000-0000-000000000000",
	})
	if out.OK || out.Error.Code != "approval_expired" {
		t.Fatalf("approve unknown = %+v, want approval_expired", out.Error)
	}
}

func TestWriteDisabledWithoutDeps(t *testing.T) {
	store, folderID, _ := setupFolder(t)
	ctx := context.Background()
	out := callJSON(t, ctx, store, Deps{}, map[string]any{
		"op": "write_file", "folderId": folderID, "path": "a.md", "content": "x",
	})
	if out.OK || out.Error.Code != "unavailable" {
		t.Fatalf("write without deps = %+v, want unavailable", out.Error)
	}
}

func TestManualModeGatesPlainWrites(t *testing.T) {
	store, folderID, deps := setupFolder(t)
	deps.Mode = mode.New("manual")
	ctx := context.Background()
	// In manual mode even a plain text write needs a dashboard approval.
	out := callJSON(t, ctx, store, deps, map[string]any{
		"op": "write_file", "folderId": folderID, "path": "a.md", "content": "hello\n",
	})
	if !out.OK {
		t.Fatalf("first call failed: %+v", out.Error)
	}
	var approval approvalResult
	if err := json.Unmarshal(out.Result, &approval); err != nil {
		t.Fatal(err)
	}
	if approval.Status != "approval_required" || approval.RequestID == "" {
		t.Fatalf("result = %+v, want approval_required", approval)
	}
	if out := callJSON(t, ctx, store, deps, map[string]any{
		"op": "approve_request", "requestId": approval.RequestID,
	}); !out.OK {
		t.Fatalf("approve_request failed: %+v", out.Error)
	}
	done := callJSON(t, ctx, store, deps, map[string]any{
		"op": "write_file", "folderId": folderID, "path": "a.md",
		"content": "hello\n", "approvalId": approval.RequestID,
	})
	if !done.OK {
		t.Fatalf("second call failed: %+v", done.Error)
	}
}

func TestNoModeFailsClosedToManual(t *testing.T) {
	store, folderID, deps := setupFolder(t)
	deps.Mode = nil
	ctx := context.Background()
	out := callJSON(t, ctx, store, deps, map[string]any{
		"op": "write_file", "folderId": folderID, "path": "a.md", "content": "hello\n",
	})
	if !out.OK {
		t.Fatalf("first call failed: %+v", out.Error)
	}
	var approval approvalResult
	if err := json.Unmarshal(out.Result, &approval); err != nil {
		t.Fatal(err)
	}
	if approval.Status != "approval_required" {
		t.Fatalf("result = %+v, want approval_required (fail closed)", approval)
	}
}
