// Package update checks GitHub releases for a newer FolderLink, downloads
// it, verifies the checksum, and replaces the installed binary.
//
// The check runs against the public releases/latest API, which needs no
// authentication. A release is newer when its tag is a higher semantic
// version than the running binary's version (the goreleaser build sets
// main.version from the tag, so a release build reports e.g. "0.2.0").
//
// Replacing a running binary is not possible on Windows: the file is
// locked while the process runs. So the background bridge never swaps the
// binary itself. It downloads and verifies the new binary, stages it next
// to the current one, and hands the swap to a short-lived helper process
// that waits for this process to exit, moves the staged file into place,
// and starts the login task again. On macOS and Linux the running binary
// can be replaced in place, so the bridge swaps it and exits; the
// LaunchAgent or systemd unit restarts it. `folderlink update` (a separate
// console process) can swap directly, because it stops the background
// bridge first.
//
// The previous binary is kept as folderlink.old (and folderlink-bg.old on
// Windows) so `folderlink update --rollback` can put it back.
package update

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const Repo = "mmuizahmed/folderlink"

// APIBase is the releases/latest endpoint. It is a variable so tests can
// point it at a local server.
var APIBase = "https://api.github.com/repos/" + Repo + "/releases/latest"

const (
	maxDownloadBytes = 64 << 20
	maxBinaryBytes   = 32 << 20
)

// Release is one GitHub release, reduced to what the updater needs.
type Release struct {
	Tag    string
	Assets map[string]string // asset name -> download URL
}

type releaseJSON struct {
	TagName string `json:"tag_name"`
	Assets  []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

// Compare returns -1, 0 or 1 when a is older than, equal to, or newer than
// b. Versions are semantic versions with an optional leading "v". A
// pre-release suffix (e.g. "-beta.1") sorts before the release itself.
// "dev" and anything unparseable sort before every real version.
func Compare(a, b string) int {
	av := parseVersion(a)
	bv := parseVersion(b)
	for i := 0; i < 3; i++ {
		if av.nums[i] != bv.nums[i] {
			if av.nums[i] < bv.nums[i] {
				return -1
			}
			return 1
		}
	}
	if av.pre == bv.pre {
		return 0
	}
	if av.pre == "" {
		return 1
	}
	if bv.pre == "" {
		return -1
	}
	if av.pre < bv.pre {
		return -1
	}
	return 1
}

type parsedVersion struct {
	nums [3]int
	pre  string
}

func parseVersion(s string) parsedVersion {
	s = strings.TrimSpace(strings.TrimPrefix(s, "v"))
	var out parsedVersion
	if s == "" {
		return out
	}
	if i := strings.Index(s, "-"); i >= 0 {
		out.pre = s[i+1:]
		s = s[:i]
	}
	if i := strings.Index(s, "+"); i >= 0 {
		s = s[:i]
	}
	parts := strings.Split(s, ".")
	for i := 0; i < 3 && i < len(parts); i++ {
		n, err := strconv.Atoi(parts[i])
		if err != nil {
			return parsedVersion{}
		}
		out.nums[i] = n
	}
	return out
}

// AssetName returns the release asset name for a platform: one archive per
// platform. On Windows the zip holds both folderlink.exe and
// folderlink-bg.exe; elsewhere the tarball holds the single folderlink
// binary.
func AssetName(goos, goarch string) string {
	if goos == "windows" {
		return "folderlink_windows_" + goarch + ".zip"
	}
	return "folderlink_" + goos + "_" + goarch + ".tar.gz"
}

// BinaryNames returns the binary file names inside the release asset for a
// platform: both exes on Windows, the single folderlink binary elsewhere.
func BinaryNames(goos string) []string {
	if goos == "windows" {
		return []string{"folderlink.exe", "folderlink-bg.exe"}
	}
	return []string{"folderlink"}
}

// Check asks GitHub for the latest release and returns it when its tag is
// newer than current. It returns nil, nil when this binary is up to date.
func Check(ctx context.Context, client *http.Client, current string) (*Release, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, APIBase, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "FolderLink/"+current)
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github releases returned %s", res.Status)
	}
	var body releaseJSON
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&body); err != nil {
		return nil, fmt.Errorf("github releases response was not valid: %w", err)
	}
	if body.TagName == "" {
		return nil, fmt.Errorf("github releases response had no tag")
	}
	if Compare(current, body.TagName) >= 0 {
		return nil, nil
	}
	rel := &Release{Tag: body.TagName, Assets: map[string]string{}}
	for _, asset := range body.Assets {
		if asset.Name != "" && asset.BrowserDownloadURL != "" {
			rel.Assets[asset.Name] = asset.BrowserDownloadURL
		}
	}
	return rel, nil
}

// Fetch downloads the release asset for this platform, verifies it
// against checksums.txt from the same release, and extracts the binaries.
// It returns the binary contents keyed by file name ("folderlink",
// "folderlink.exe", "folderlink-bg.exe"). Nothing is written to disk.
func Fetch(ctx context.Context, client *http.Client, rel *Release) (map[string][]byte, error) {
	name := AssetName(runtime.GOOS, runtime.GOARCH)
	url, ok := rel.Assets[name]
	if !ok {
		return nil, fmt.Errorf("release %s has no asset %s", rel.Tag, name)
	}
	sums, err := fetchChecksums(ctx, client, rel)
	if err != nil {
		return nil, err
	}
	want, ok := sums[name]
	if !ok {
		return nil, fmt.Errorf("checksums.txt has no entry for %s", name)
	}
	raw, err := download(ctx, client, url)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != want {
		return nil, fmt.Errorf("checksum mismatch for %s", name)
	}
	return extract(name, raw, BinaryNames(runtime.GOOS))
}

func fetchChecksums(ctx context.Context, client *http.Client, rel *Release) (map[string]string, error) {
	url, ok := rel.Assets["checksums.txt"]
	if !ok {
		// The checksum file is also published under releases/latest/download.
		url = "https://github.com/" + Repo + "/releases/latest/download/checksums.txt"
	}
	raw, err := download(ctx, client, url)
	if err != nil {
		return nil, err
	}
	sums := map[string]string{}
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		name := fields[1]
		name = strings.TrimPrefix(name, "*")
		name = filepath.Base(name)
		sums[name] = strings.ToLower(fields[0])
	}
	if len(sums) == 0 {
		return nil, fmt.Errorf("checksums.txt was empty")
	}
	return sums, nil
}

func download(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "FolderLink")
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download of %s returned %s", url, res.Status)
	}
	return io.ReadAll(io.LimitReader(res.Body, maxDownloadBytes+1))
}

// extract returns the named binaries from a zip or tar.gz archive.
// Anything else in the archive is ignored, and an archive missing any
// named binary is an error.
func extract(asset string, raw []byte, want []string) (map[string][]byte, error) {
	wanted := map[string]bool{}
	for _, name := range want {
		wanted[name] = true
	}
	out := map[string][]byte{}
	if strings.HasSuffix(asset, ".zip") {
		zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
		if err != nil {
			return nil, fmt.Errorf("the %s archive was not valid: %w", asset, err)
		}
		for _, f := range zr.File {
			name := filepath.Base(f.Name)
			if !wanted[name] {
				continue
			}
			bin, err := readEntry(f)
			if err != nil {
				return nil, err
			}
			out[name] = bin
		}
	} else if strings.HasSuffix(asset, ".tar.gz") {
		gr, err := gzip.NewReader(bytes.NewReader(raw))
		if err != nil {
			return nil, fmt.Errorf("the %s archive was not valid: %w", asset, err)
		}
		tr := tar.NewReader(gr)
		for {
			header, err := tr.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				return nil, fmt.Errorf("the %s archive was not valid: %w", asset, err)
			}
			name := filepath.Base(header.Name)
			if !wanted[name] {
				continue
			}
			bin, err := io.ReadAll(io.LimitReader(tr, maxBinaryBytes+1))
			if err != nil {
				return nil, err
			}
			out[name] = bin
		}
	} else {
		return nil, fmt.Errorf("unsupported asset %s", asset)
	}
	for _, name := range want {
		if _, ok := out[name]; !ok {
			return nil, fmt.Errorf("the %s archive has no %s", asset, name)
		}
	}
	return out, nil
}

func readEntry(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer func() { _ = rc.Close() }()
	raw, err := io.ReadAll(io.LimitReader(rc, maxBinaryBytes+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > maxBinaryBytes {
		return nil, fmt.Errorf("the binary in the archive is too large")
	}
	return raw, nil
}

// Stage writes each new binary next to the installed one, as
// "<name>.new", and returns the staged paths. It does not touch the
// running binary, so it is safe to call while the bridge is running.
func Stage(dir string, binaries map[string][]byte) (map[string]string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	staged := map[string]string{}
	for name, data := range binaries {
		if len(data) == 0 || len(data) > maxBinaryBytes {
			return nil, fmt.Errorf("the staged %s is not a valid binary", name)
		}
		path := filepath.Join(dir, name+".new")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			return nil, err
		}
		if err := os.Chmod(path, 0o755); err != nil {
			return nil, err
		}
		staged[name] = path
	}
	return staged, nil
}

// Swap moves each staged binary into place, keeping the previous binary
// as "<name>.old" for rollback. The caller must have stopped the bridge
// first on Windows, where a running exe is locked.
func Swap(dir string, staged map[string]string) error {
	for name, stagedPath := range staged {
		target := filepath.Join(dir, name)
		old := filepath.Join(dir, name+".old")
		if _, err := os.Stat(target); err == nil {
			_ = os.Remove(old)
			if err := os.Rename(target, old); err != nil {
				return err
			}
		}
		if err := os.Rename(stagedPath, target); err != nil {
			// Put the old binary back if the swap failed halfway.
			_ = os.Rename(old, target)
			return err
		}
	}
	return nil
}

// Rollback puts the previous binaries back. The caller must have stopped
// the bridge first on Windows.
func Rollback(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	rolled := false
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".old") {
			continue
		}
		target := filepath.Join(dir, strings.TrimSuffix(name, ".old"))
		if err := os.Rename(filepath.Join(dir, name), target); err != nil {
			return err
		}
		rolled = true
	}
	if !rolled {
		return fmt.Errorf("no previous version is kept to roll back to")
	}
	return nil
}

// HasRollback reports whether a previous binary is kept in dir.
func HasRollback(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".old") {
			return true
		}
	}
	return false
}

// DefaultClient is the HTTP client for release checks: 30 seconds is
// plenty for the GitHub API and a binary download, and it bounds a
// stalled check.
func DefaultClient() *http.Client {
	return &http.Client{Timeout: 30 * time.Second}
}
