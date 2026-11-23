package guard

import (
	"context"
	"os"
	"time"
)

// InfoResult is metadata about one path, without its contents.
type InfoResult struct {
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
	Ignored bool   `json:"ignored"`
}

// Info reports size, kind and modification time for one path inside root.
// Secret and denylisted paths are refused. A path that is only ignored by
// .gitignore still reports metadata, with Ignored set, so the caller can
// decide whether to ask for it.
func Info(ctx context.Context, root, rel string) (*InfoResult, error) {
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
	info, err := os.Lstat(realTarget)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, code("not_found", "No file or directory at that path.")
		}
		return nil, code("invalid_path", "The path could not be read.")
	}
	kind := "other"
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		kind = "symlink"
	case info.IsDir():
		kind = "dir"
	case info.Mode().IsRegular():
		kind = "file"
	}
	parent := parentRel(relReal)
	rules := collectRules(realRoot, parent)
	result := &InfoResult{
		Name:    info.Name(),
		Kind:    kind,
		Size:    info.Size(),
		ModTime: info.ModTime().UTC().Format(time.RFC3339),
		Ignored: ignored(relReal, info.IsDir(), rules),
	}
	return result, nil
}
