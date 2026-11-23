package guard

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSearchFindsNamesAndLines(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "src", "main.go"), "package main\n\n// hello world\nfunc main() {}\n")
	mustWrite(t, filepath.Join(root, "src", "hello.txt"), "say hello again\nsecond line\n")
	mustWrite(t, filepath.Join(root, "notes.md"), "nothing here\n")
	mustWrite(t, filepath.Join(root, "skip.log"), "hello in a log\n")

	result, err := Search(context.Background(), root, "", "hello", 0)
	if err != nil {
		t.Fatal(err)
	}
	if result.FilesScanned != 4 {
		t.Fatalf("files scanned = %d, want 4", result.FilesScanned)
	}
	paths := map[string]int{}
	for _, match := range result.Matches {
		paths[match.Path]++
		if match.Line == 0 && match.Text == "" {
			t.Fatalf("empty match: %+v", match)
		}
	}
	if paths["src/hello.txt"] == 0 {
		t.Fatalf("missing content match in src/hello.txt: %+v", result.Matches)
	}
	if paths["src/main.go"] == 0 {
		t.Fatalf("missing content match in src/main.go: %+v", result.Matches)
	}
	// The filename itself contains the query, so hello.txt also matches by name.
	foundName := false
	for _, match := range result.Matches {
		if match.Path == "src/hello.txt" && match.Line == 0 {
			foundName = true
		}
	}
	if !foundName {
		t.Fatalf("missing filename match for hello.txt: %+v", result.Matches)
	}
}

func TestSearchRespectsBoundaries(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "app.go"), "needle here\n")
	mustWrite(t, filepath.Join(root, ".env"), "needle secret\n")
	mustWrite(t, filepath.Join(root, "ignored.txt"), "needle ignored\n")
	mustWrite(t, filepath.Join(root, ".gitignore"), "ignored.txt\n")
	mustWrite(t, filepath.Join(root, "node_modules", "dep.js"), "needle dep\n")
	mustWrite(t, filepath.Join(root, "bin.dat"), "needle\x00binary\n")

	result, err := Search(context.Background(), root, "", "needle", 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, match := range result.Matches {
		if match.Path == ".env" || match.Path == "ignored.txt" ||
			strings.HasPrefix(match.Path, "node_modules/") || match.Path == "bin.dat" {
			t.Fatalf("search leaked %s: %+v", match.Path, result.Matches)
		}
	}
	if len(result.Matches) != 1 || result.Matches[0].Path != "app.go" {
		t.Fatalf("matches = %+v, want only app.go", result.Matches)
	}
}

func TestSearchCaps(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < 10; i++ {
		mustWrite(t, filepath.Join(root, "f"+itoa(i)+".txt"), "needle\nneedle\nneedle\n")
	}
	result, err := Search(context.Background(), root, "", "needle", 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Matches) != 3 {
		t.Fatalf("matches = %d, want 3", len(result.Matches))
	}
	if !result.Truncated {
		t.Fatal("expected truncated")
	}
	if _, err := Search(context.Background(), root, "", "  ", 0); err == nil {
		t.Fatal("expected an error for an empty query")
	}
}

func TestMediaAndInfo(t *testing.T) {
	root := t.TempDir()
	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3}
	mustWrite(t, filepath.Join(root, "shot.png"), string(png))
	mustWrite(t, filepath.Join(root, "plain.txt"), "hello\n")
	mustWrite(t, filepath.Join(root, ".env"), "SECRET=1\n")

	media, err := Media(context.Background(), root, "shot.png", 0)
	if err != nil {
		t.Fatal(err)
	}
	if media.MimeType != "image/png" {
		t.Fatalf("mime = %s, want image/png", media.MimeType)
	}
	decoded, err := base64.StdEncoding.DecodeString(media.Base64)
	if err != nil || string(decoded) != string(png) {
		t.Fatal("base64 did not round-trip")
	}
	if _, err := Media(context.Background(), root, "plain.txt", 0); err == nil {
		t.Fatal("expected text files to be refused by read_media")
	}
	if _, err := Media(context.Background(), root, ".env", 0); err == nil {
		t.Fatal("expected secrets to be refused by read_media")
	}
	if _, err := Media(context.Background(), root, "../outside.png", 0); err == nil {
		t.Fatal("expected escape to be refused by read_media")
	}

	info, err := Info(context.Background(), root, "plain.txt")
	if err != nil {
		t.Fatal(err)
	}
	if info.Name != "plain.txt" || info.Kind != "file" || info.Size != 6 || info.Ignored {
		t.Fatalf("info = %+v", info)
	}
	mustWrite(t, filepath.Join(root, ".gitignore"), "plain.txt\n")
	info, err = Info(context.Background(), root, "plain.txt")
	if err != nil {
		t.Fatal(err)
	}
	if !info.Ignored {
		t.Fatalf("expected ignored flag: %+v", info)
	}
	if _, err := Info(context.Background(), root, ".env"); err == nil {
		t.Fatal("expected secrets to be refused by file_info")
	}
	if _, err := os.Stat(filepath.Join(root, "plain.txt")); err != nil {
		t.Fatal(err)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := ""
	for n > 0 {
		digits = string(rune('0'+n%10)) + digits
		n /= 10
	}
	return digits
}
