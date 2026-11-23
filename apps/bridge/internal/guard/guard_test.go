package guard

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestReadAndListInsideRoot(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "notes", "hello.txt"), "hello from the bridge\nsecond\n")
	ctx := context.Background()

	got, err := Read(ctx, root, "notes/hello.txt", ReadRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if got.Content != "hello from the bridge\nsecond\n" || got.Truncated {
		t.Fatalf("%#v", got)
	}

	lines, err := Read(ctx, root, "notes/hello.txt", ReadRequest{StartLine: 2, EndLine: 2})
	if err != nil {
		t.Fatal(err)
	}
	if lines.Content != "second\n" || lines.StartLine != 2 || lines.EndLine != 2 {
		t.Fatalf("%#v", lines)
	}

	page, err := List(ctx, root, "", "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Entries) != 1 || page.Entries[0].Name != "notes" || page.Entries[0].Kind != "dir" {
		t.Fatalf("%#v", page)
	}
}

func TestPathContainment(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "proj")
	evil := filepath.Join(parent, "proj-evil")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(evil, 0o755); err != nil {
		t.Fatal(err)
	}
	const secret = "EVILCONTENT"
	mustWrite(t, filepath.Join(evil, "x.txt"), secret)
	mustWrite(t, filepath.Join(root, "ok.txt"), "safe")

	ctx := context.Background()
	_, err := Read(ctx, root, "../proj-evil/x.txt", ReadRequest{})
	assertSafe(t, err, "outside_root", root, secret)

	if err := os.Symlink(filepath.Join(evil, "x.txt"), filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	_, err = Read(ctx, root, "link", ReadRequest{})
	assertSafe(t, err, "outside_root", root, secret)

	if err := os.Symlink(evil, filepath.Join(root, "dirlink")); err != nil {
		t.Fatal(err)
	}
	_, err = Read(ctx, root, "dirlink/x.txt", ReadRequest{})
	assertSafe(t, err, "outside_root", root, secret)

	inside := filepath.Join(root, "nested")
	if err := os.Mkdir(inside, 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(inside, "a.txt"), "inside")
	if err := os.Symlink(filepath.Join(inside, "a.txt"), filepath.Join(root, "good-link")); err != nil {
		t.Fatal(err)
	}
	got, err := Read(ctx, root, "good-link", ReadRequest{})
	if err != nil || got.Content != "inside" {
		t.Fatalf("inside symlink: %v %#v", err, got)
	}

	if err := os.Symlink(root, filepath.Join(root, "loop")); err != nil {
		t.Fatal(err)
	}
	_, err = Read(ctx, root, "loop/loop/ok.txt", ReadRequest{})
	if err != nil && CodeOf(err) == "outside_root" {
		t.Fatalf("symlink that stays inside was rejected: %v", err)
	}
	if err != nil {
		t.Fatal(err)
	}
}

func TestDenylistAndGitignore(t *testing.T) {
	root := t.TempDir()
	const secret = "SUPERSECRETVALUE"
	mustWrite(t, filepath.Join(root, ".env"), secret)
	mustWrite(t, filepath.Join(root, ".env.local"), secret)
	mustWrite(t, filepath.Join(root, "keys", "id_rsa"), secret)
	mustWrite(t, filepath.Join(root, "app.pem"), secret)
	mustWrite(t, filepath.Join(root, "node_modules", "pkg", "index.js"), "module")
	mustWrite(t, filepath.Join(root, ".git", "config"), "git")
	mustWrite(t, filepath.Join(root, "build", "out.js"), "built")
	mustWrite(t, filepath.Join(root, "debug.log"), "log")
	mustWrite(t, filepath.Join(root, "keep.log"), "keep")
	mustWrite(t, filepath.Join(root, "visible.txt"), "visible")
	mustWrite(t, filepath.Join(root, ".gitignore"), "*.log\n!keep.log\n")

	ctx := context.Background()
	for _, rel := range []string{".env", ".env.local", "keys/id_rsa", "app.pem", "node_modules/pkg/index.js", ".git/config", "build/out.js", "debug.log"} {
		_, err := Read(ctx, root, rel, ReadRequest{})
		assertSafe(t, err, "denied", root, secret)
	}
	got, err := Read(ctx, root, "keep.log", ReadRequest{})
	if err != nil || got.Content != "keep" {
		t.Fatalf("negated gitignore: %v %#v", err, got)
	}

	page, err := List(ctx, root, "", "", 50)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, entry := range page.Entries {
		names[entry.Name] = true
	}
	for _, hidden := range []string{".env", ".env.local", "app.pem", "node_modules", ".git", "build", "debug.log"} {
		if names[hidden] {
			t.Fatalf("listed %s: %#v", hidden, page.Entries)
		}
	}
	if !names["visible.txt"] || !names["keep.log"] || !names["keys"] {
		t.Fatalf("missing visible names: %#v", page.Entries)
	}
}

func TestPaginationBinaryAndRanges(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"a.txt", "b.txt", "c.txt", "d.txt"} {
		mustWrite(t, filepath.Join(root, name), name)
	}
	ctx := context.Background()
	page, err := List(ctx, root, "", "", 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Entries) != 2 || page.NextCursor == nil || !page.Truncated {
		t.Fatalf("first page %#v", page)
	}
	page2, err := List(ctx, root, "", *page.NextCursor, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(page2.Entries) != 2 || page2.Entries[0].Name != "c.txt" {
		t.Fatalf("second page %#v", page2)
	}

	big := strings.Repeat("abcdefghij", 8000) // 80_000 bytes
	mustWrite(t, filepath.Join(root, "big.txt"), big)
	part, err := Read(ctx, root, "big.txt", ReadRequest{MaxBytes: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if !part.Truncated || part.NextByteOffset == nil || part.BytesRead != 1000 {
		t.Fatalf("%#v", part)
	}
	rest, err := Read(ctx, root, "big.txt", ReadRequest{ByteOffset: *part.NextByteOffset, MaxBytes: DefaultMaxBytes})
	if err != nil {
		t.Fatal(err)
	}
	if part.Content+rest.Content != big[:len(part.Content)+len(rest.Content)] {
		t.Fatal("chunks do not line up")
	}

	mustWrite(t, filepath.Join(root, "bin.dat"), "text\x00more")
	_, err = Read(ctx, root, "bin.dat", ReadRequest{})
	if err == nil || CodeOf(err) != "binary" || strings.Contains(err.Error(), "more") {
		t.Fatalf("binary: %v", err)
	}

	_, err = Read(ctx, root, "missing.txt", ReadRequest{})
	if err == nil || CodeOf(err) != "not_found" || strings.Contains(err.Error(), root) {
		t.Fatalf("missing: %v", err)
	}
}

func TestSpecialFilesAndRoot(t *testing.T) {
	root := t.TempDir()
	fifo := filepath.Join(root, "pipe")
	if err := syscall.Mkfifo(fifo, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := Read(context.Background(), root, "pipe", ReadRequest{})
	if err == nil || CodeOf(err) == "internal" {
		t.Fatalf("fifo: %v", err)
	}
	if _, err := ValidateRoot("/"); err == nil {
		t.Fatal("filesystem root was accepted")
	}
	if _, err := ValidateRoot(root); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Read(ctx, root, "pipe", ReadRequest{}); CodeOf(err) != "timeout" {
		t.Fatalf("canceled context: %v", err)
	}
}

func assertSafe(t *testing.T, err error, code, root, secret string) {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error")
	}
	if CodeOf(err) != code {
		t.Fatalf("code %s, err %v", CodeOf(err), err)
	}
	if strings.Contains(err.Error(), root) || strings.Contains(err.Error(), secret) {
		t.Fatalf("error leaked data: %v", err)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}
