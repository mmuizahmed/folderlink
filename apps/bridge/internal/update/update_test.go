package update

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestCompare(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.2.0", "0.2.0", 0},
		{"v0.2.0", "0.2.0", 0},
		{"0.1.0", "0.2.0", -1},
		{"0.2.0", "0.1.0", 1},
		{"0.2.1", "0.2.0", 1},
		{"0.10.0", "0.2.0", 1},
		{"1.0.0", "0.9.9", 1},
		{"0.2.0-beta.1", "0.2.0", -1},
		{"0.2.0-beta.1", "0.2.0-beta.2", -1},
		{"dev", "0.1.0", -1},
		{"", "0.1.0", -1},
		{"0.2.0", "dev", 1},
		{"garbage", "0.1.0", -1},
	}
	for _, tc := range cases {
		if got := Compare(tc.a, tc.b); got != tc.want {
			t.Errorf("Compare(%q, %q) = %d, want %d", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestAssetNames(t *testing.T) {
	console, bg := AssetNames("windows", "amd64")
	if console != "folderlink_windows_amd64.zip" || bg != "folderlink-bg_windows_amd64.zip" {
		t.Errorf("windows assets = %q, %q", console, bg)
	}
	console, bg = AssetNames("darwin", "arm64")
	if console != "folderlink_darwin_arm64.tar.gz" || bg != "" {
		t.Errorf("darwin assets = %q, %q", console, bg)
	}
	console, bg = AssetNames("linux", "amd64")
	if console != "folderlink_linux_amd64.tar.gz" || bg != "" {
		t.Errorf("linux assets = %q, %q", console, bg)
	}
}

func TestCheck(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/releases/latest" {
			fmt.Fprintf(w, `{"tag_name":"v0.3.0","assets":[
				{"name":"folderlink_linux_amd64.tar.gz","browser_download_url":"%s/dl/linux"},
				{"name":"checksums.txt","browser_download_url":"%s/dl/sums"}
			]}`, serverURL(r), serverURL(r))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	old := APIBase
	APIBase = server.URL + "/releases/latest"
	defer func() { APIBase = old }()

	rel, err := Check(context.Background(), server.Client(), "0.2.0")
	if err != nil {
		t.Fatal(err)
	}
	if rel == nil || rel.Tag != "v0.3.0" {
		t.Fatalf("Check = %+v, want tag v0.3.0", rel)
	}
	if rel.Assets["checksums.txt"] == "" {
		t.Errorf("Check did not record the checksums asset")
	}
	upToDate, err := Check(context.Background(), server.Client(), "0.3.0")
	if err != nil {
		t.Fatal(err)
	}
	if upToDate != nil {
		t.Errorf("Check with current 0.3.0 = %+v, want nil (up to date)", upToDate)
	}
}

func serverURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func TestFetchVerifiesChecksums(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Fetch test uses the tar.gz asset for this platform")
	}
	console, _ := AssetNames(runtime.GOOS, runtime.GOARCH)
	// Build a tar.gz holding a fake binary, and its checksum.
	var archive bytes.Buffer
	gz := gzip.NewWriter(&archive)
	tw := tar.NewWriter(gz)
	body := []byte("fake-binary-0.3.0")
	binName := binaryName(runtime.GOOS, console)
	if err := tw.WriteHeader(&tar.Header{Name: binName, Mode: 0o755, Size: int64(len(body))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	asset := archive.Bytes()
	sum := sha256.Sum256(asset)
	sums := hex.EncodeToString(sum[:]) + "  " + console + "\n"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/dl/bin":
			_, _ = w.Write(asset)
		case "/dl/sums":
			_, _ = w.Write([]byte(sums))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	rel := &Release{Tag: "v0.3.0", Assets: map[string]string{
		console:         server.URL + "/dl/bin",
		"checksums.txt": server.URL + "/dl/sums",
	}}
	got, err := Fetch(context.Background(), server.Client(), rel)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got[binName], body) {
		t.Errorf("Fetch = %q, want the fake binary", got[binName])
	}

	// A tampered archive must fail the checksum check.
	bad := append(append([]byte{}, asset...), 'x')
	server2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/dl/bin":
			_, _ = w.Write(bad)
		case "/dl/sums":
			_, _ = w.Write([]byte(sums))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server2.Close()
	rel2 := &Release{Tag: "v0.3.0", Assets: map[string]string{
		console:         server2.URL + "/dl/bin",
		"checksums.txt": server2.URL + "/dl/sums",
	}}
	if _, err := Fetch(context.Background(), server2.Client(), rel2); err == nil {
		t.Errorf("Fetch with a tampered archive succeeded, want a checksum error")
	}
}

func TestFetchZip(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Fetch zip test is for the Windows asset")
	}
	var archive bytes.Buffer
	zw := zip.NewWriter(&archive)
	w, err := zw.Create("folderlink.exe")
	if err != nil {
		t.Fatal(err)
	}
	body := []byte("fake-binary-0.3.0")
	if _, err := w.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	asset := archive.Bytes()
	sum := sha256.Sum256(asset)
	sums := hex.EncodeToString(sum[:]) + "  folderlink_windows_amd64.zip\n" +
		hex.EncodeToString(sum[:]) + "  folderlink-bg_windows_amd64.zip\n"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/dl/win":
			_, _ = w.Write(asset)
		case "/dl/bg":
			_, _ = w.Write(asset)
		case "/dl/sums":
			_, _ = w.Write([]byte(sums))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	rel := &Release{Tag: "v0.3.0", Assets: map[string]string{
		"folderlink_windows_amd64.zip":    server.URL + "/dl/win",
		"folderlink-bg_windows_amd64.zip": server.URL + "/dl/bg",
		"checksums.txt":                   server.URL + "/dl/sums",
	}}
	got, err := Fetch(context.Background(), server.Client(), rel)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got["folderlink.exe"], body) || !bytes.Equal(got["folderlink-bg.exe"], body) {
		t.Errorf("Fetch zip = %v, want both binaries", got)
	}
}

func TestStageSwapRollback(t *testing.T) {
	dir := t.TempDir()
	current := filepath.Join(dir, "folderlink")
	if err := os.WriteFile(current, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	staged, err := Stage(dir, map[string][]byte{"folderlink": []byte("new")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(staged["folderlink"]); err != nil {
		t.Fatal(err)
	}
	if err := Swap(dir, staged); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(current)
	if err != nil || string(raw) != "new" {
		t.Fatalf("after Swap, current = %q, %v", raw, err)
	}
	old, err := os.ReadFile(filepath.Join(dir, "folderlink.old"))
	if err != nil || string(old) != "old" {
		t.Fatalf("after Swap, .old = %q, %v", old, err)
	}
	if !HasRollback(dir) {
		t.Errorf("HasRollback = false after Swap")
	}
	if err := Rollback(dir); err != nil {
		t.Fatal(err)
	}
	raw, err = os.ReadFile(current)
	if err != nil || string(raw) != "old" {
		t.Fatalf("after Rollback, current = %q, %v", raw, err)
	}
	if HasRollback(dir) {
		t.Errorf("HasRollback = true after Rollback")
	}
	if err := Rollback(dir); err == nil {
		t.Errorf("second Rollback succeeded, want an error")
	}
}

func TestStageRejectsOversize(t *testing.T) {
	dir := t.TempDir()
	big := make([]byte, maxBinaryBytes+1)
	if _, err := Stage(dir, map[string][]byte{"folderlink": big}); err == nil {
		t.Errorf("Stage accepted an oversize binary")
	}
}

func TestExtractRejectsUnknownArchive(t *testing.T) {
	if _, err := extract("folderlink_linux_amd64.tar.gz", []byte("not an archive")); err == nil {
		t.Errorf("extract accepted garbage")
	}
	if _, err := extract("folderlink_windows_amd64.zip", []byte("not an archive")); err == nil {
		t.Errorf("extract accepted garbage")
	}
}

func TestFetchMissingAsset(t *testing.T) {
	rel := &Release{Tag: "v0.3.0", Assets: map[string]string{}}
	if _, err := Fetch(context.Background(), http.DefaultClient, rel); err == nil {
		t.Errorf("Fetch with no assets succeeded")
	} else if !strings.Contains(err.Error(), "checksums") && !strings.Contains(err.Error(), "asset") {
		t.Errorf("Fetch error = %v, want a missing-asset/checksum error", err)
	}
}
