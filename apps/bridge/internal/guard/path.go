package guard

import (
	"path/filepath"
	"runtime"
	"strings"
)

// Within reports whether target is the same path as root or a descendant of it.
// The caller passes paths that have already been cleaned and symlink-resolved.
func Within(root, target string) bool {
	return withinGeneric(root, target, string(filepath.Separator), runtime.GOOS == "windows")
}

func withinGeneric(root, target, sep string, fold bool) bool {
	if root == "" || target == "" || strings.ContainsRune(root, 0) || strings.ContainsRune(target, 0) {
		return false
	}
	if fold {
		root = strings.ToLower(root)
		target = strings.ToLower(target)
	}
	root = cleanGeneric(root, sep)
	target = cleanGeneric(target, sep)
	if volumePrefix(root, sep) != volumePrefix(target, sep) {
		return false
	}
	if root == target {
		return true
	}
	prefix := root
	if !strings.HasSuffix(prefix, sep) {
		prefix += sep
	}
	return strings.HasPrefix(target, prefix)
}

func cleanGeneric(path, sep string) string {
	vol := volumePrefix(path, sep)
	rest := strings.TrimPrefix(path, vol)
	absolute := strings.HasPrefix(rest, sep) || (vol == "" && strings.HasPrefix(path, sep))
	var stack []string
	for _, part := range strings.Split(rest, sep) {
		if part == "" || part == "." {
			continue
		}
		if part == ".." {
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
			continue
		}
		stack = append(stack, part)
	}
	joined := strings.Join(stack, sep)
	switch {
	case vol != "":
		if joined == "" {
			return vol + sep
		}
		return vol + sep + joined
	case absolute:
		if joined == "" {
			return sep
		}
		return sep + joined
	default:
		if joined == "" {
			return "."
		}
		return joined
	}
}

func volumePrefix(path, sep string) string {
	if sep != `\` {
		return ""
	}
	switch {
	case strings.HasPrefix(path, `\\?\UNC\`):
		rest := strings.TrimPrefix(path, `\\?\UNC\`)
		parts := strings.Split(rest, `\`)
		if len(parts) >= 2 && parts[0] != "" && parts[1] != "" {
			return `\\?\UNC\` + parts[0] + `\` + parts[1]
		}
		return path
	case strings.HasPrefix(path, `\\?\`):
		rest := strings.TrimPrefix(path, `\\?\`)
		if len(rest) >= 2 && rest[1] == ':' {
			return `\\?\` + rest[:2]
		}
		return path
	case strings.HasPrefix(path, `\\`):
		rest := strings.TrimPrefix(path, `\\`)
		parts := strings.Split(rest, `\`)
		if len(parts) >= 2 && parts[0] != "" && parts[1] != "" {
			return `\\` + parts[0] + `\` + parts[1]
		}
		return path
	default:
		if len(path) >= 2 && path[1] == ':' && isASCIILetter(path[0]) {
			return path[:2]
		}
		return ""
	}
}

func isASCIILetter(b byte) bool {
	return (b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z')
}

// CleanRelative normalizes a protocol path. The result uses forward slashes and
// never escapes the folder it will be joined to. An empty result is the folder itself.
func CleanRelative(rel string) (string, error) {
	if len(rel) > 4096 || strings.ContainsRune(rel, 0) {
		return "", code("invalid_path", "The path is not valid.")
	}
	rel = strings.ReplaceAll(rel, "\\", "/")
	if strings.Contains(rel, ":") || strings.HasPrefix(rel, "/") {
		return "", code("outside_root", "The path is outside the allowed folder.")
	}
	var stack []string
	for _, part := range strings.Split(rel, "/") {
		if part == "" || part == "." {
			continue
		}
		if part == ".." {
			if len(stack) == 0 {
				return "", code("outside_root", "The path is outside the allowed folder.")
			}
			stack = stack[:len(stack)-1]
			continue
		}
		if len(part) > 255 || strings.HasSuffix(part, " ") || strings.HasSuffix(part, ".") {
			return "", code("invalid_path", "The path is not valid.")
		}
		for _, r := range part {
			if r < 0x20 || r == 0x7f {
				return "", code("invalid_path", "The path is not valid.")
			}
		}
		if reservedWindowsName(part) {
			return "", code("invalid_path", "The path is not valid.")
		}
		stack = append(stack, part)
	}
	return strings.Join(stack, "/"), nil
}

func reservedWindowsName(name string) bool {
	base := name
	if i := strings.IndexAny(base, ".:"); i >= 0 {
		base = base[:i]
	}
	switch strings.ToUpper(base) {
	case "CON", "PRN", "AUX", "NUL":
		return true
	}
	if len(base) == 4 {
		prefix := strings.ToUpper(base[:3])
		last := base[3]
		if (prefix == "COM" || prefix == "LPT") && last >= '1' && last <= '9' {
			return true
		}
	}
	return false
}
