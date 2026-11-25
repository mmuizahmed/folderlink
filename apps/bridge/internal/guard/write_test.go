package guard

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrepareAndExecuteWrite(t *testing.T) {
	root := t.TempDir()
	ctx := context.Background()
	content := []byte("hello\nworld\n")
	plan, err := PrepareWrite(ctx, root, "notes.md", content)
	if err != nil {
		t.Fatalf("PrepareWrite: %v", err)
	}
	if plan.PreHash != AbsentHash {
		t.Fatalf("PreHash = %q, want absent", plan.PreHash)
	}
	if plan.ContentHash != HashBytes(content) {
		t.Fatal("ContentHash does not match the bytes")
	}
	if !strings.Contains(plan.Diff, "+hello") {
		t.Fatalf("diff is missing the added line: %q", plan.Diff)
	}
	post, err := ExecuteWrite(ctx, root, plan, content)
	if err != nil {
		t.Fatalf("ExecuteWrite: %v", err)
	}
	if post != plan.ContentHash {
		t.Fatal("post-write hash is not the content hash")
	}
	raw, err := os.ReadFile(filepath.Join(root, "notes.md"))
	if err != nil || string(raw) != string(content) {
		t.Fatalf("written file = %q, err %v", raw, err)
	}
}

func TestWriteOverwriteAndTOCTOU(t *testing.T) {
	root := t.TempDir()
	ctx := context.Background()
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("v1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan, err := PrepareWrite(ctx, root, "a.txt", []byte("v2\n"))
	if err != nil {
		t.Fatalf("PrepareWrite: %v", err)
	}
	if !strings.Contains(plan.Diff, "-v1") || !strings.Contains(plan.Diff, "+v2") {
		t.Fatalf("diff is wrong: %q", plan.Diff)
	}
	// The file changes after approval: the write must refuse.
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("v1.5\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ExecuteWrite(ctx, root, plan, []byte("v2\n")); CodeOf(err) != "hash_mismatch" {
		t.Fatalf("ExecuteWrite after external change = %v, want hash_mismatch", err)
	}
	// Content drift in the second call refuses too.
	plan2, err := PrepareWrite(ctx, root, "a.txt", []byte("v3\n"))
	if err != nil {
		t.Fatalf("PrepareWrite: %v", err)
	}
	if _, err := ExecuteWrite(ctx, root, plan2, []byte("different\n")); CodeOf(err) != "hash_mismatch" {
		t.Fatalf("ExecuteWrite with different content = %v, want hash_mismatch", err)
	}
	if _, err := ExecuteWrite(ctx, root, plan2, []byte("v3\n")); err != nil {
		t.Fatalf("ExecuteWrite: %v", err)
	}
	raw, _ := os.ReadFile(filepath.Join(root, "a.txt"))
	if string(raw) != "v3\n" {
		t.Fatalf("file = %q, want v3", raw)
	}
}

func TestWriteRefusals(t *testing.T) {
	root := t.TempDir()
	ctx := context.Background()
	cases := []struct {
		rel  string
		want string
	}{
		{".env", "denied"},
		{".git/config", "denied"},
		{"node_modules/x.js", "denied"},
		{"../escape.txt", "outside_root"},
		{"missing-dir/f.txt", "not_found"},
		{"", "bad_request"},
	}
	for _, tc := range cases {
		if _, err := PrepareWrite(ctx, root, tc.rel, []byte("x")); CodeOf(err) != tc.want {
			t.Errorf("PrepareWrite(%q) = %v, want code %q", tc.rel, err, tc.want)
		}
	}
	if err := os.Mkdir(filepath.Join(root, "dir"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareWrite(ctx, root, "dir", []byte("x")); CodeOf(err) != "bad_request" {
		t.Errorf("PrepareWrite(dir) = %v, want bad_request", err)
	}
	// A symlink at the target is replaced, not followed: the write lands
	// on the link itself and the file it pointed at is untouched.
	real := filepath.Join(root, "real.txt")
	if err := os.WriteFile(real, []byte("real"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, filepath.Join(root, "link.txt")); err != nil {
		t.Fatal(err)
	}
	plan, err := PrepareWrite(ctx, root, "link.txt", []byte("new\n"))
	if err != nil {
		t.Fatalf("PrepareWrite(symlink): %v", err)
	}
	if _, err := ExecuteWrite(ctx, root, plan, []byte("new\n")); err != nil {
		t.Fatalf("ExecuteWrite(symlink): %v", err)
	}
	raw, _ := os.ReadFile(real)
	if string(raw) != "real" {
		t.Fatalf("pointed-at file changed to %q", raw)
	}
	link, _ := os.Readlink(filepath.Join(root, "link.txt"))
	if link != "" {
		t.Fatalf("link.txt is still a symlink to %q", link)
	}
	// A symlink pointing outside the folder is refused outright.
	outside := t.TempDir()
	target := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(target, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(root, "escape.txt")); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareWrite(ctx, root, "escape.txt", []byte("x")); CodeOf(err) != "outside_root" {
		t.Fatalf("PrepareWrite(outside symlink) = %v, want outside_root", err)
	}
}

func TestBinaryContent(t *testing.T) {
	if !IsBinaryContent([]byte("a\x00b")) || !IsBinaryContent([]byte{0xff, 0xfe}) {
		t.Error("binary content was not detected")
	}
	if IsBinaryContent([]byte("plain text\n")) {
		t.Error("plain text was called binary")
	}
	root := t.TempDir()
	ctx := context.Background()
	plan, err := PrepareWrite(ctx, root, "img.bin", []byte{0x89, 0x50, 0x4e, 0x47})
	if err != nil {
		t.Fatalf("PrepareWrite: %v", err)
	}
	if !plan.Binary {
		t.Error("binary write was not flagged")
	}
	if !strings.Contains(plan.Diff, "Binary file") {
		t.Fatalf("binary diff = %q", plan.Diff)
	}
}

func TestDeletePreviewAndExecute(t *testing.T) {
	root := t.TempDir()
	ctx := context.Background()
	if err := os.WriteFile(filepath.Join(root, "old.txt"), []byte("line1\nline2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	preview, err := PrepareDelete(ctx, root, "old.txt")
	if err != nil {
		t.Fatalf("PrepareDelete: %v", err)
	}
	if preview.Size != 12 || !strings.Contains(preview.Preview, "line1") {
		t.Fatalf("preview = %+v", preview)
	}
	if err := ExecuteDelete(ctx, root, preview); err != nil {
		t.Fatalf("ExecuteDelete: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "old.txt")); !os.IsNotExist(err) {
		t.Fatal("file was not deleted")
	}
	// Deleting a missing file is an error, not an approval.
	if _, err := PrepareDelete(ctx, root, "old.txt"); CodeOf(err) != "not_found" {
		t.Fatalf("PrepareDelete(missing) = %v, want not_found", err)
	}
	// A file that changes after the preview refuses the delete.
	if err := os.WriteFile(filepath.Join(root, "b.txt"), []byte("v1"), 0o600); err != nil {
		t.Fatal(err)
	}
	preview, err = PrepareDelete(ctx, root, "b.txt")
	if err != nil {
		t.Fatalf("PrepareDelete: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "b.txt"), []byte("v2"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := ExecuteDelete(ctx, root, preview); CodeOf(err) != "hash_mismatch" {
		t.Fatalf("ExecuteDelete after change = %v, want hash_mismatch", err)
	}
}
