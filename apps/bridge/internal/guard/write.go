// Package guard writes live here too: the same containment and denylist
// that gate reads gate writes, plus the hash binding the approval flow
// depends on. A write is prepared (validated, hashed, diffed) before any
// approval is asked for, and executed only after the approval token is
// verified — the second call re-checks the live file, so a file that
// changed between approval and execution refuses instead of writing.
//
// Writes are atomic: content goes to a fresh temp file in the same
// directory and is renamed over the target, so a failed write never
// leaves a half-written file and a symlink at the target is replaced,
// never followed.
package guard

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// MaxWriteBytes caps one write_file call. The worker's HTTP body cap is
// 256KB, so a larger write could never arrive intact.
const MaxWriteBytes = 200 * 1024

// MaxDiffLines caps the files the bridge diffs line by line. Larger
// files still write; the dashboard shows hashes and sizes instead of a
// diff.
const MaxDiffLines = 4000

// MaxDiffBytes caps the unified diff text sent to the dashboard.
const MaxDiffBytes = 64 * 1024

// MaxDeletePreviewBytes caps the preview of a file about to be deleted.
const MaxDeletePreviewBytes = 2048

// AbsentHash is the pre-write hash for a file that does not exist yet.
// Binding it means a second call cannot silently create over a file
// that appeared after approval, or overwrite one that was deleted.
const AbsentHash = "absent"

// ExecutableExts are the file extensions a client-card-only write may
// never touch. A write to one of these always needs dashboard approval:
// an injected instruction that lands a script is the T1 payload.
var ExecutableExts = map[string]bool{
	".sh": true, ".ps1": true, ".bat": true, ".cmd": true,
	".exe": true, ".com": true, ".msi": true,
	".py": true, ".js": true, ".ts": true, ".mjs": true, ".cjs": true,
	".rb": true, ".pl": true, ".php": true, ".vbs": true,
	".jar": true, ".dll": true, ".so": true, ".dylib": true,
}

// IsExecutablePath reports whether rel names an executable or script file.
// The check is by extension only and applies in every folder: there is
// no "source folder" exception, because a script dropped into a source
// folder is exactly what a toolchain would run next.
func IsExecutablePath(rel string) bool {
	return ExecutableExts[strings.ToLower(ext(filepath.Base(rel)))]
}

// HashBytes returns the hex SHA-256 of b.
func HashBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// IsBinaryContent reports whether content is not plain UTF-8 text. Binary
// writes always need dashboard approval: they cannot be reviewed in a
// client card.
func IsBinaryContent(content []byte) bool {
	return bytesContainsNUL(content) || !utf8.Valid(content)
}

// WritePlan is everything the approval flow remembers about a write
// without holding the bytes: the hashes bind the exact content, so the
// second call re-sends the content and the bridge refuses on any drift.
type WritePlan struct {
	// RealTarget is the resolved absolute path to write.
	RealTarget string
	// Rel is the slash path as the caller named it.
	Rel string
	// PreHash is the SHA-256 of the current file, or AbsentHash.
	PreHash string
	// ContentHash is the SHA-256 of the exact bytes to write.
	ContentHash string
	// Diff is the bridge-computed unified diff (text writes only), or a
	// short summary when the file is binary or too large to diff.
	Diff string
	// Binary reports whether the new content is binary.
	Binary bool
	// Exists reports whether the target file exists now.
	Exists bool
	// Size is the current file size in bytes, or -1 for a new file.
	Size int64
}

// PrepareWrite validates a write and computes its hashes and diff. It
// writes nothing.
func PrepareWrite(ctx context.Context, root, rel string, content []byte) (*WritePlan, error) {
	if err := ctx.Err(); err != nil {
		return nil, code("timeout", "The request timed out.")
	}
	if len(content) > MaxWriteBytes {
		return nil, code("too_large", "The content is too large to write.")
	}
	if rel == "" {
		return nil, code("bad_request", "A file path is required.")
	}
	if err := denyPath(rel); err != nil {
		return nil, code("denied", "The path is refused by the default denylist.")
	}
	parent, base := parentRel(rel), filepath.Base(filepath.FromSlash(rel))
	if base == "" || base == "." || base == ".." {
		return nil, code("bad_request", "The file path is not valid.")
	}
	realRoot, realParent, _, err := resolveParent(root, parent)
	if err != nil {
		return nil, err
	}
	realTarget := filepath.Join(realParent, base)
	plan := &WritePlan{
		RealTarget:  realTarget,
		Rel:         rel,
		PreHash:     AbsentHash,
		ContentHash: HashBytes(content),
		Binary:      IsBinaryContent(content),
		Size:        -1,
	}
	// If the target exists, resolve it (a symlink is followed for the
	// hash and the diff) and refuse directories.
	if info, err := os.Lstat(realTarget); err == nil {
		if info.IsDir() {
			return nil, code("bad_request", "The path is a directory.")
		}
		real, err := filepath.EvalSymlinks(realTarget)
		if err != nil {
			return nil, code("invalid_path", "The path could not be resolved.")
		}
		if !Within(realRoot, real) {
			return nil, code("outside_root", "The path is outside the allowed folder.")
		}
		plan.Exists = true
		plan.Size = info.Size()
		if info.Size() <= 512*1024 {
			before, err := os.ReadFile(real)
			if err != nil {
				if os.IsPermission(err) {
					return nil, code("denied", "The file is not readable.")
				}
				return nil, code("invalid_path", "The path could not be opened.")
			}
			plan.PreHash = HashBytes(before)
			plan.Diff = diffForWrite(rel, before, content, plan.Binary)
		} else {
			// A large file is hashed by streaming and never read fully:
			// the dashboard shows hashes and sizes instead of a diff.
			hash, err := hashFile(real)
			if err != nil {
				return nil, err
			}
			plan.PreHash = hash
			plan.Diff = fmt.Sprintf("File too large for a line diff (%d bytes). SHA-256 before %s, after %s.",
				info.Size(), hash, plan.ContentHash)
		}
	} else if !os.IsNotExist(err) {
		return nil, code("invalid_path", "The path could not be resolved.")
	} else {
		plan.Diff = diffForWrite(rel, nil, content, plan.Binary)
	}
	return plan, nil
}

// resolveParent resolves the directory that will contain the write. The
// parent must exist and stay inside the root; a missing parent is an
// error, not something the bridge creates.
func resolveParent(root, parent string) (realRoot, realParent, relReal string, err error) {
	if parent == "" {
		realRoot, realParent, relReal, err = resolve(root, "")
		return realRoot, realParent, relReal, err
	}
	realRoot, realParent, relReal, err = resolve(root, parent)
	if err != nil {
		if CodeOf(err) == "not_found" {
			return "", "", "", code("not_found", "The parent directory does not exist.")
		}
		return "", "", "", err
	}
	return realRoot, realParent, relReal, err
}

// hashFile returns the hex SHA-256 of a file, streamed so large files
// never load fully into memory.
func hashFile(real string) (string, error) {
	f, err := os.Open(real)
	if err != nil {
		if os.IsNotExist(err) {
			return "", code("not_found", "No file or directory at that path.")
		}
		if os.IsPermission(err) {
			return "", code("denied", "The file is not readable.")
		}
		return "", code("invalid_path", "The path could not be opened.")
	}
	defer func() { _ = f.Close() }()
	sum := sha256.New()
	if _, err := io.Copy(sum, f); err != nil {
		return "", code("invalid_path", "The file could not be read.")
	}
	return hex.EncodeToString(sum.Sum(nil)), nil
}

// diffForWrite renders the dashboard diff for a write. Binary content
// gets a size/hash summary instead of a diff; files too large to diff
// line by line get the same treatment.
func diffForWrite(rel string, before, after []byte, binary bool) string {
	if binary || IsBinaryContent(before) {
		return fmt.Sprintf("Binary file: %d bytes now, %d bytes after. SHA-256 before %s, after %s.",
			len(before), len(after), HashBytes(before), HashBytes(after))
	}
	beforeLines := splitLines(before)
	afterLines := splitLines(after)
	if len(beforeLines) > MaxDiffLines || len(afterLines) > MaxDiffLines {
		return fmt.Sprintf("File too large for a line diff (%d lines now, %d after). SHA-256 before %s, after %s.",
			len(beforeLines), len(afterLines), HashBytes(before), HashBytes(after))
	}
	return unifiedDiff(rel, beforeLines, afterLines)
}

// ExecuteWrite re-validates a prepared write against the live file and
// writes it atomically. The content is re-hashed and compared to the
// plan, so a second call that changes the bytes refuses instead of
// writing. It returns the post-write hash.
func ExecuteWrite(ctx context.Context, root string, plan *WritePlan, content []byte) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", code("timeout", "The request timed out.")
	}
	if HashBytes(content) != plan.ContentHash {
		return "", code("hash_mismatch", "The content changed since approval. Ask for approval again.")
	}
	// Re-resolve and re-hash the live file: a file that changed between
	// approval and execution refuses instead of writing.
	live, err := PrepareWrite(ctx, root, plan.Rel, content)
	if err != nil {
		return "", err
	}
	if live.PreHash != plan.PreHash {
		return "", code("hash_mismatch", "The file changed since approval. Ask for approval again.")
	}
	if err := writeAtomic(ctx, live.RealTarget, content); err != nil {
		return "", err
	}
	return plan.ContentHash, nil
}

// writeAtomic writes content to a fresh temp file in the target's
// directory and renames it over the target. The rename replaces a
// symlink instead of following it.
func writeAtomic(ctx context.Context, realTarget string, content []byte) error {
	if err := ctx.Err(); err != nil {
		return code("timeout", "The request timed out.")
	}
	dir := filepath.Dir(realTarget)
	tmp, err := os.CreateTemp(dir, ".folderlink-*")
	if err != nil {
		if os.IsPermission(err) {
			return code("denied", "The file could not be written.")
		}
		return code("invalid_path", "The file could not be written.")
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()
	// Preserve the mode of a file being overwritten; new files are 0644.
	mode := os.FileMode(0o644)
	if info, err := os.Stat(realTarget); err == nil {
		mode = info.Mode().Perm()
	}
	if _, err := tmp.Write(content); err != nil {
		_ = tmp.Close()
		return code("invalid_path", "The file could not be written.")
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return code("invalid_path", "The file could not be written.")
	}
	if err := tmp.Close(); err != nil {
		return code("invalid_path", "The file could not be written.")
	}
	if err := os.Chmod(tmpName, mode); err != nil {
		return code("invalid_path", "The file could not be written.")
	}
	if err := os.Rename(tmpName, realTarget); err != nil {
		if os.IsPermission(err) {
			return code("denied", "The file could not be written.")
		}
		return code("invalid_path", "The file could not be written.")
	}
	return nil
}

// DeletePreview is what the dashboard shows before a delete: the size,
// a first-lines preview of what will be lost, and the hash that binds
// the approval to the exact bytes.
type DeletePreview struct {
	RealTarget string
	Rel        string
	Size       int64
	Preview    string
	PreHash    string
}

// PrepareDelete validates a delete and reads its preview. It deletes
// nothing.
func PrepareDelete(ctx context.Context, root, rel string) (*DeletePreview, error) {
	if err := ctx.Err(); err != nil {
		return nil, code("timeout", "The request timed out.")
	}
	if rel == "" {
		return nil, code("bad_request", "A file path is required.")
	}
	if err := denyPath(rel); err != nil {
		return nil, code("denied", "The path is refused by the default denylist.")
	}
	_, realTarget, _, err := resolve(root, rel)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(realTarget)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, code("not_found", "No file or directory at that path.")
		}
		return nil, code("invalid_path", "The path could not be resolved.")
	}
	if info.IsDir() {
		return nil, code("bad_request", "The path is a directory.")
	}
	raw, err := os.ReadFile(realTarget)
	if err != nil {
		if os.IsPermission(err) {
			return nil, code("denied", "The file is not readable.")
		}
		return nil, code("invalid_path", "The path could not be opened.")
	}
	preview := raw
	if len(preview) > MaxDeletePreviewBytes {
		preview = preview[:MaxDeletePreviewBytes]
	}
	return &DeletePreview{
		RealTarget: realTarget,
		Rel:        rel,
		Size:       info.Size(),
		Preview:    previewText(preview, info.Size()),
		PreHash:    HashBytes(raw),
	}, nil
}

// previewText renders the first bytes of a file for the delete card.
// Binary files get a summary; text gets its first lines.
func previewText(head []byte, size int64) string {
	if IsBinaryContent(head) {
		return fmt.Sprintf("Binary file, %d bytes. SHA-256 %s.", size, HashBytes(head))
	}
	lines := splitLines(head)
	if len(lines) > 20 {
		lines = lines[:20]
	}
	text := strings.Join(lines, "\n")
	if int64(len(head)) < size {
		text += "\n…"
	}
	return text
}

// ExecuteDelete re-validates a prepared delete against the live file and
// removes the named path. It removes the link itself when the path is a
// symlink, never the file it points at.
func ExecuteDelete(ctx context.Context, root string, preview *DeletePreview) error {
	if err := ctx.Err(); err != nil {
		return code("timeout", "The request timed out.")
	}
	live, err := PrepareDelete(ctx, root, preview.Rel)
	if err != nil {
		return err
	}
	if live.PreHash != preview.PreHash {
		return code("hash_mismatch", "The file changed since approval. Ask for approval again.")
	}
	if err := os.Remove(live.RealTarget); err != nil {
		if os.IsNotExist(err) {
			return code("not_found", "No file or directory at that path.")
		}
		if os.IsPermission(err) {
			return code("denied", "The file could not be deleted.")
		}
		return code("invalid_path", "The file could not be deleted.")
	}
	return nil
}

// splitLines splits bytes into lines without keeping the newlines. A
// trailing newline does not create an empty last line.
func splitLines(b []byte) []string {
	if len(b) == 0 {
		return nil
	}
	text := strings.TrimSuffix(string(b), "\n")
	if text == "" {
		return []string{""}
	}
	return strings.Split(text, "\n")
}
