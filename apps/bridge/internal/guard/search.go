package guard

import (
	"bufio"
	"context"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

const (
	// DefaultSearchMatches is the number of matches Search returns when the
	// caller does not ask for a smaller number.
	DefaultSearchMatches = 50
	// MaxSearchMatches is the most matches Search ever returns.
	MaxSearchMatches = 100
	// maxSearchFiles is the most files Search opens in one call.
	maxSearchFiles = 3000
	// maxSearchBytes is the most file content Search reads in one call.
	maxSearchBytes = 32 << 20
	// maxSearchFileSize is the largest single file Search opens.
	maxSearchFileSize = 1 << 20
	// maxSearchLine is the longest line Search keeps in a match.
	maxSearchLine = 200
	// maxSearchText is the most match text Search returns in one call.
	maxSearchText = 200 * 1024
)

// SearchMatch is one filename or content hit.
type SearchMatch struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Text string `json:"text"`
}

// SearchResult is the outcome of one search.
type SearchResult struct {
	Matches      []SearchMatch `json:"matches"`
	FilesScanned int           `json:"filesScanned"`
	Truncated    bool          `json:"truncated"`
}

// Search finds files whose name contains the query and lines of text files
// that contain it, inside root/rel. It reuses the same boundary rules as
// List and Read: containment, the secret denylist, and .gitignore. Binary
// files are skipped, never read as text.
func Search(ctx context.Context, root, rel, query string, maxMatches int) (*SearchResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, code("timeout", "The request timed out.")
	}
	cleaned, err := CleanRelative(rel)
	if err != nil {
		return nil, err
	}
	if err := denyPath(cleaned); err != nil {
		return nil, err
	}
	query = strings.TrimSpace(query)
	if query == "" || len(query) > 200 {
		return nil, code("bad_request", "A search term of 1 to 200 characters is required.")
	}
	if maxMatches <= 0 {
		maxMatches = DefaultSearchMatches
	}
	if maxMatches > MaxSearchMatches {
		maxMatches = MaxSearchMatches
	}
	realRoot, realTarget, relReal, err := resolve(root, cleaned)
	if err != nil {
		return nil, err
	}
	if err := denyPath(relReal); err != nil {
		return nil, err
	}
	if err := ensureSupported(realTarget, true); err != nil {
		return nil, err
	}
	lower := strings.ToLower(query)
	result := &SearchResult{Matches: []SearchMatch{}}
	var scannedFiles int
	var scannedBytes int64
	var textBytes int
	truncated := false
	stop := func() bool {
		return len(result.Matches) >= maxMatches || textBytes >= maxSearchText
	}
	err = filepath.WalkDir(realTarget, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if stop() || scannedFiles >= maxSearchFiles || scannedBytes >= maxSearchBytes {
			truncated = true
			return filepath.SkipAll
		}
		relPath, relErr := filepath.Rel(realRoot, path)
		if relErr != nil {
			return nil
		}
		relSlash := filepath.ToSlash(relPath)
		if relSlash == "." {
			return nil
		}
		if denyErr := denyPath(relSlash); denyErr != nil {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		parent := parentRel(relSlash)
		rules := collectRules(realRoot, parent)
		if ignored(relSlash, entry.IsDir(), rules) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil || info.Size() > maxSearchFileSize {
			return nil
		}
		// A filename hit needs no content read.
		if strings.Contains(strings.ToLower(entry.Name()), lower) {
			textBytes += len(entry.Name())
			result.Matches = append(result.Matches, SearchMatch{
				Path: relSlash,
				Line: 0,
				Text: entry.Name(),
			})
			if stop() {
				truncated = true
				return filepath.SkipAll
			}
		}
		scannedFiles++
		scannedBytes += info.Size()
		if err := searchFile(ctx, path, relSlash, lower, maxMatches, &textBytes, result); err != nil {
			if _, ok := err.(errStop); ok {
				truncated = true
				return filepath.SkipAll
			}
			return err
		}
		return nil
	})
	if err != nil {
		if ce, ok := err.(*CodeError); ok {
			return nil, ce
		}
		return nil, code("timeout", "The request timed out.")
	}
	result.FilesScanned = scannedFiles
	result.Truncated = truncated || len(result.Matches) >= maxMatches || textBytes >= maxSearchText
	return result, nil
}

func searchFile(ctx context.Context, path, relSlash, lower string, maxMatches int, textBytes *int, result *SearchResult) error {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer func() { _ = f.Close() }()
	if err := sniffBinary(f, 0); err != nil {
		// Binary files are skipped, never an error for the whole search.
		return nil
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil
	}
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	line := 0
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return err
		}
		line++
		text := scanner.Text()
		if !strings.Contains(strings.ToLower(text), lower) {
			continue
		}
		trimmed := strings.TrimSpace(text)
		if len(trimmed) > maxSearchLine {
			trimmed = trimmed[:maxSearchLine]
		}
		*textBytes += len(trimmed)
		result.Matches = append(result.Matches, SearchMatch{
			Path: relSlash,
			Line: line,
			Text: trimmed,
		})
		if len(result.Matches) >= maxMatches || *textBytes >= maxSearchText {
			return errStop{}
		}
	}
	return nil
}
