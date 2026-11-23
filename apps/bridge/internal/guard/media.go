package guard

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"strings"
)

const (
	// DefaultMediaBytes is the most media Search returns when the caller
	// does not ask for less.
	DefaultMediaBytes = 128 * 1024
	// HardMediaBytes is the most media ever returned. Base64 grows the
	// payload by a third, and the worker refuses results over 300 KB, so
	// 200 KB of media is the safe ceiling.
	HardMediaBytes = 200 * 1024
)

var mediaByExtension = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".bmp":  "image/bmp",
	".ico":  "image/x-icon",
	".svg":  "image/svg+xml",
	".pdf":  "application/pdf",
}

// MediaResult is one media file, base64-encoded so it survives JSON.
type MediaResult struct {
	MimeType  string `json:"mimeType"`
	Size      int64  `json:"size"`
	Base64    string `json:"base64"`
	Truncated bool   `json:"truncated"`
}

// Media reads an image or other media file inside root. Text files are
// refused: read_file already covers them. Secrets and ignored paths are
// refused by the same rules as Read.
func Media(ctx context.Context, root, rel string, maxBytes int) (*MediaResult, error) {
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
	if maxBytes <= 0 {
		maxBytes = DefaultMediaBytes
	}
	if maxBytes > HardMediaBytes {
		maxBytes = HardMediaBytes
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
	buf := make([]byte, maxBytes)
	n, err := io.ReadFull(f, buf)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return nil, code("invalid_path", "The file could not be read.")
	}
	buf = buf[:n]
	mime := mediaMime(relReal, buf)
	if strings.HasPrefix(mime, "text/") {
		return nil, code("bad_request", "Text files are read with read_file, not read_media.")
	}
	result := &MediaResult{
		MimeType:  mime,
		Size:      info.Size(),
		Base64:    base64.StdEncoding.EncodeToString(buf),
		Truncated: int64(n) < info.Size(),
	}
	return result, nil
}

func mediaMime(rel string, head []byte) string {
	lower := strings.ToLower(rel)
	for ext, mime := range mediaByExtension {
		if strings.HasSuffix(lower, ext) {
			return mime
		}
	}
	return http.DetectContentType(head)
}
