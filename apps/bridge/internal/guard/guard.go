// Package guard reads and lists files inside one explicitly allowed folder.
// Every public operation resolves symlinks and refuses paths that leave that folder.
package guard

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

const (
	DefaultMaxBytes  = 64 * 1024
	HardMaxBytes     = 256 * 1024
	DefaultListLimit = 100
	MaxListLimit     = 200
	maxDirEntries    = 50000
	maxScan          = 10000
	binarySniff      = 8192
	maxLineScan      = 8 * 1024 * 1024
)

// CodeError is a failure that is safe to show to the caller.
// Messages never include file contents or an absolute path.
type CodeError struct {
	Code string
	Msg  string
}

func (e *CodeError) Error() string { return e.Msg }

func code(c, msg string) *CodeError { return &CodeError{Code: c, Msg: msg} }

// CodeOf returns the public error code, or "internal" for unexpected failures.
func CodeOf(err error) string {
	var ce *CodeError
	if errors.As(err, &ce) {
		return ce.Code
	}
	return "internal"
}

type Entry struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
	Size int64  `json:"size"`
}

type ListResult struct {
	Entries    []Entry `json:"entries"`
	NextCursor *string `json:"nextCursor"`
	Truncated  bool    `json:"truncated"`
}

type ReadRequest struct {
	StartLine  int
	EndLine    int
	ByteOffset int64
	MaxBytes   int
}

type ReadResult struct {
	Content        string `json:"content"`
	StartLine      int    `json:"startLine"`
	EndLine        int    `json:"endLine"`
	ByteOffset     int64  `json:"byteOffset"`
	BytesRead      int    `json:"bytesRead"`
	FileSize       int64  `json:"fileSize"`
	Truncated      bool   `json:"truncated"`
	NextByteOffset *int64 `json:"nextByteOffset"`
}

// ValidateRoot resolves path and rejects the filesystem root and non-directories.
func ValidateRoot(path string) (string, error) {
	if strings.ContainsRune(path, 0) || strings.TrimSpace(path) == "" {
		return "", code("invalid_path", "The folder path is not valid.")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", code("invalid_path", "The folder path is not valid.")
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", code("invalid_path", "The folder is not available.")
	}
	info, err := os.Stat(real)
	if err != nil || !info.IsDir() {
		return "", code("invalid_path", "The folder is not a directory.")
	}
	if filesystemRoot(real) {
		return "", code("invalid_path", "The filesystem root cannot be allowed.")
	}
	return real, nil
}

func filesystemRoot(path string) bool {
	clean := filepath.Clean(path)
	sep := string(filepath.Separator)
	if clean == sep {
		return true
	}
	vol := volumePrefix(clean, sep)
	rest := strings.TrimPrefix(clean, vol)
	rest = strings.Trim(rest, sep)
	return vol != "" && rest == ""
}

// List returns one page of names inside root/rel.
func List(ctx context.Context, root, rel, cursor string, limit int) (*ListResult, error) {
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
	limit = clampLimit(limit)
	cursorName, err := decodeCursor(cursor)
	if err != nil {
		return nil, err
	}
	realRoot, realTarget, relReal, err := resolve(root, cleaned)
	if err != nil {
		return nil, err
	}
	if err := denyPath(relReal); err != nil {
		return nil, err
	}
	rules := collectRules(realRoot, relReal)
	if ignored(relReal, true, rules) {
		return nil, code("denied", "The path is ignored.")
	}
	if err := ensureSupported(realTarget, true); err != nil {
		return nil, err
	}
	f, err := openContained(realRoot, realTarget)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		return nil, code("invalid_path", "The path could not be read.")
	}
	if !info.IsDir() {
		return nil, code("not_a_directory", "The path is not a directory.")
	}
	entries, err := f.ReadDir(-1)
	if err != nil {
		return nil, code("invalid_path", "The directory could not be read.")
	}
	if len(entries) > maxDirEntries {
		return nil, code("too_large", "The directory has too many entries to list.")
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	start := 0
	if cursorName != "" {
		start = sort.Search(len(entries), func(i int) bool { return entries[i].Name() > cursorName })
	}
	out := make([]Entry, 0, limit)
	scanned := 0
	lastName := ""
	for _, entry := range entries[start:] {
		if err := ctx.Err(); err != nil {
			return nil, code("timeout", "The request timed out.")
		}
		scanned++
		name := entry.Name()
		lastName = name
		if name == "" || strings.ContainsRune(name, 0) || strings.ContainsAny(name, "/\\") {
			continue
		}
		childRel := name
		if relReal != "" {
			childRel = relReal + "/" + name
		}
		if err := denyPath(childRel); err != nil {
			continue
		}
		isDir := entry.IsDir()
		if ignored(childRel, isDir, rules) {
			continue
		}
		kind := "other"
		switch {
		case entry.Type()&os.ModeSymlink != 0:
			kind = "symlink"
		case entry.IsDir():
			kind = "dir"
		case entry.Type().IsRegular():
			kind = "file"
		}
		size := int64(0)
		if info, infoErr := entry.Info(); infoErr == nil {
			size = info.Size()
		}
		out = append(out, Entry{Name: name, Kind: kind, Size: size})
		if len(out) == limit || scanned >= maxScan {
			break
		}
	}
	result := &ListResult{Entries: out}
	more := false
	if lastName != "" {
		idx := sort.Search(len(entries), func(i int) bool { return entries[i].Name() > lastName })
		more = idx < len(entries)
	}
	if more {
		encoded := encodeCursor(lastName)
		result.NextCursor = &encoded
		result.Truncated = true
	}
	return result, nil
}

// Read returns a UTF-8 window of a regular file inside root.
func Read(ctx context.Context, root, rel string, req ReadRequest) (*ReadResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, code("timeout", "The request timed out.")
	}
	cleaned, err := CleanRelative(rel)
	if err != nil {
		return nil, err
	}
	if cleaned == "" {
		return nil, code("bad_request", "A file path is required.")
	}
	if err := denyPath(cleaned); err != nil {
		return nil, err
	}
	if req.StartLine < 0 || req.EndLine < 0 || req.ByteOffset < 0 {
		return nil, code("bad_request", "The requested range is not valid.")
	}
	if req.StartLine > 0 && req.ByteOffset > 0 {
		return nil, code("bad_request", "Choose either a line range or a byte offset.")
	}
	if (req.StartLine == 0) != (req.EndLine == 0) || (req.EndLine > 0 && req.EndLine < req.StartLine) {
		return nil, code("bad_request", "The requested line range is not valid.")
	}
	maxBytes := req.MaxBytes
	if maxBytes <= 0 {
		maxBytes = DefaultMaxBytes
	}
	if maxBytes > HardMaxBytes {
		maxBytes = HardMaxBytes
	}
	realRoot, realTarget, relReal, err := resolve(root, cleaned)
	if err != nil {
		return nil, err
	}
	if err := denyPath(relReal); err != nil {
		return nil, err
	}
	parent := parentRel(relReal)
	rules := collectRules(realRoot, parent)
	if ignored(relReal, false, rules) {
		return nil, code("denied", "The path is ignored.")
	}
	if err := ensureSupported(realTarget, false); err != nil {
		return nil, err
	}
	f, err := openContained(realRoot, realTarget)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		return nil, code("invalid_path", "The path could not be read.")
	}
	if !info.Mode().IsRegular() {
		return nil, code("invalid_path", "The path is not a regular file.")
	}
	if req.StartLine > 0 {
		return readLines(ctx, f, info.Size(), req.StartLine, req.EndLine, maxBytes)
	}
	return readBytes(ctx, f, info.Size(), req.ByteOffset, maxBytes)
}

func clampLimit(limit int) int {
	if limit <= 0 {
		return DefaultListLimit
	}
	if limit > MaxListLimit {
		return MaxListLimit
	}
	return limit
}

func encodeCursor(name string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(name))
}

func decodeCursor(cursor string) (string, error) {
	if cursor == "" {
		return "", nil
	}
	if len(cursor) > 512 {
		return "", code("bad_request", "The cursor is not valid.")
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil || bytesContainsNUL(raw) {
		return "", code("bad_request", "The cursor is not valid.")
	}
	return string(raw), nil
}

func bytesContainsNUL(b []byte) bool {
	for _, c := range b {
		if c == 0 {
			return true
		}
	}
	return false
}

func parentRel(rel string) string {
	i := strings.LastIndex(rel, "/")
	if i < 0 {
		return ""
	}
	return rel[:i]
}

func resolve(root, rel string) (realRoot, realTarget, relReal string, err error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", "", "", code("invalid_path", "The allowed folder is not available.")
	}
	realRoot, err = filepath.EvalSymlinks(abs)
	if err != nil {
		return "", "", "", code("invalid_path", "The allowed folder is not available.")
	}
	rootInfo, err := os.Stat(realRoot)
	if err != nil || !rootInfo.IsDir() {
		return "", "", "", code("invalid_path", "The allowed folder is not a directory.")
	}
	lexical := realRoot
	if rel != "" {
		lexical = filepath.Join(realRoot, filepath.FromSlash(rel))
	}
	if !Within(realRoot, lexical) {
		return "", "", "", code("outside_root", "The path is outside the allowed folder.")
	}
	realTarget, err = filepath.EvalSymlinks(lexical)
	if err != nil {
		if os.IsNotExist(err) {
			return "", "", "", code("not_found", "No file or directory at that path.")
		}
		return "", "", "", code("invalid_path", "The path could not be resolved.")
	}
	if !Within(realRoot, realTarget) {
		return "", "", "", code("outside_root", "The path is outside the allowed folder.")
	}
	relReal, err = filepath.Rel(realRoot, realTarget)
	if err != nil || relReal == ".." || strings.HasPrefix(relReal, ".."+string(filepath.Separator)) {
		return "", "", "", code("outside_root", "The path is outside the allowed folder.")
	}
	relReal = filepath.ToSlash(relReal)
	if relReal == "." {
		relReal = ""
	}
	return realRoot, realTarget, relReal, nil
}

func openContained(root, target string) (*os.File, error) {
	f, err := os.Open(target)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, code("not_found", "No file or directory at that path.")
		}
		if os.IsPermission(err) {
			return nil, code("denied", "The file is not readable.")
		}
		return nil, code("invalid_path", "The path could not be opened.")
	}
	if err := verifyFD(root, f); err != nil {
		_ = f.Close()
		return nil, err
	}
	return f, nil
}

func readBytes(ctx context.Context, f *os.File, size, offset int64, maxBytes int) (*ReadResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, code("timeout", "The request timed out.")
	}
	if offset > size {
		return nil, code("bad_request", "The byte offset is past the end of the file.")
	}
	if err := sniffBinary(f, 0); err != nil {
		return nil, err
	}
	if _, err := f.Seek(offset, io.SeekStart); err != nil {
		return nil, code("invalid_path", "The file could not be read.")
	}
	buf := make([]byte, maxBytes)
	n, err := io.ReadFull(f, buf)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return nil, code("invalid_path", "The file could not be read.")
	}
	buf = buf[:n]
	if bytesContainsNUL(buf) {
		return nil, code("binary", "The file looks binary, so it was not read.")
	}
	trimmed := trimPartialUTF8(buf)
	if trimmed == nil {
		return nil, code("binary", "The file is not valid UTF-8, so it was not read.")
	}
	next := offset + int64(len(trimmed))
	result := &ReadResult{
		Content:    string(trimmed),
		ByteOffset: offset,
		BytesRead:  len(trimmed),
		FileSize:   size,
	}
	if offset == 0 {
		result.StartLine = 1
		result.EndLine = countLines(trimmed)
	}
	if next < size {
		result.Truncated = true
		result.NextByteOffset = &next
	}
	return result, nil
}

func readLines(ctx context.Context, f *os.File, size int64, start, end, maxBytes int) (*ReadResult, error) {
	if err := sniffBinary(f, 0); err != nil {
		return nil, err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, code("invalid_path", "The file could not be read.")
	}
	var (
		line      = 1
		scanned   int64
		collected []byte
		gotStart  bool
		cut       bool
	)
	buf := make([]byte, 32*1024)
	var pending []byte
	flush := func(piece []byte, final bool) error {
		pending = append(pending, piece...)
		for {
			i := strings.IndexByte(string(pending), '\n')
			if i < 0 {
				break
			}
			row := pending[:i+1]
			pending = append([]byte(nil), pending[i+1:]...)
			if err := takeLine(&line, &collected, &gotStart, &cut, row, start, end, maxBytes); err != nil {
				return err
			}
			if line > end {
				return errStop{}
			}
		}
		if final && len(pending) > 0 {
			if err := takeLine(&line, &collected, &gotStart, &cut, pending, start, end, maxBytes); err != nil {
				return err
			}
			pending = nil
		}
		return nil
	}
	for {
		if err := ctx.Err(); err != nil {
			return nil, code("timeout", "The request timed out.")
		}
		n, err := f.Read(buf)
		scanned += int64(n)
		if n > 0 {
			if bytesContainsNUL(buf[:n]) {
				return nil, code("binary", "The file looks binary, so it was not read.")
			}
			if flushErr := flush(buf[:n], false); flushErr != nil {
				if _, ok := flushErr.(errStop); ok {
					break
				}
				if ce, ok := flushErr.(*CodeError); ok {
					return nil, ce
				}
				return nil, code("invalid_path", "The file could not be read.")
			}
		}
		if scanned > maxLineScan && line <= start {
			return nil, code("too_large", "The line is beyond the portion of the file the bridge will scan. Request a byte offset instead.")
		}
		if err == io.EOF {
			if flushErr := flush(nil, true); flushErr != nil {
				if _, ok := flushErr.(errStop); !ok {
					if ce, ok := flushErr.(*CodeError); ok {
						return nil, ce
					}
					return nil, code("invalid_path", "The file could not be read.")
				}
			}
			break
		}
		if err != nil {
			return nil, code("invalid_path", "The file could not be read.")
		}
		if line > end {
			break
		}
	}
	if !gotStart {
		return nil, code("not_found", "The requested line range is past the end of the file.")
	}
	if !utf8.Valid(collected) {
		return nil, code("binary", "The file is not valid UTF-8, so it was not read.")
	}
	endLine := start
	if len(collected) > 0 {
		endLine = start + countLines(collected) - 1
	}
	result := &ReadResult{
		Content:    string(collected),
		StartLine:  start,
		EndLine:    endLine,
		BytesRead:  len(collected),
		FileSize:   size,
		ByteOffset: 0,
		Truncated:  cut,
	}
	return result, nil
}

type errStop struct{}

func (errStop) Error() string { return "stop" }

func takeLine(line *int, collected *[]byte, gotStart, cut *bool, row []byte, start, end, maxBytes int) error {
	current := *line
	*line++
	if current < start || current > end {
		return nil
	}
	*gotStart = true
	if len(*collected) >= maxBytes {
		*cut = true
		return errStop{}
	}
	room := maxBytes - len(*collected)
	if len(row) > room {
		*collected = append(*collected, row[:room]...)
		*cut = true
		return errStop{}
	}
	*collected = append(*collected, row...)
	return nil
}

func ensureSupported(path string, wantDir bool) error {
	info, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return code("not_found", "No file or directory at that path.")
		}
		return code("invalid_path", "The path could not be read.")
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return code("invalid_path", "The path could not be resolved.")
	}
	if wantDir {
		if !info.IsDir() {
			return code("not_a_directory", "The path is not a directory.")
		}
		return nil
	}
	if !info.Mode().IsRegular() {
		return code("invalid_path", "The path is not a regular file.")
	}
	return nil
}

func sniffBinary(f *os.File, offset int64) error {
	buf := make([]byte, binarySniff)
	n, err := f.ReadAt(buf, offset)
	if err != nil && !errors.Is(err, io.EOF) {
		return code("invalid_path", "The file could not be read.")
	}
	if bytesContainsNUL(buf[:n]) {
		return code("binary", "The file looks binary, so it was not read.")
	}
	return nil
}

func countLines(b []byte) int {
	if len(b) == 0 {
		return 0
	}
	n := strings.Count(string(b), "\n")
	if b[len(b)-1] != '\n' {
		n++
	}
	if n == 0 {
		return 1
	}
	return n
}

func trimPartialUTF8(b []byte) []byte {
	if utf8.Valid(b) {
		return b
	}
	for n := 1; n <= 3 && n < len(b); n++ {
		head := b[:len(b)-n]
		if utf8.Valid(head) {
			return head
		}
	}
	return nil
}
