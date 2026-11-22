package guard

import (
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

type pattern struct {
	base     string
	body     string
	negate   bool
	dirOnly  bool
	anchored bool
}

func ignored(rel string, isDir bool, pats []pattern) bool {
	if rel == "" {
		return false
	}
	walked := ""
	parts := strings.Split(rel, "/")
	for i, part := range parts {
		if walked == "" {
			walked = part
		} else {
			walked += "/" + part
		}
		last := i == len(parts)-1
		asDir := !last || isDir
		if matchIgnored(walked, asDir, pats) {
			return true
		}
	}
	return false
}

func matchIgnored(rel string, isDir bool, pats []pattern) bool {
	ignored := false
	for _, pat := range pats {
		if pat.matches(rel, isDir) {
			ignored = !pat.negate
		}
	}
	return ignored
}

func (p pattern) matches(rel string, isDir bool) bool {
	if p.dirOnly && !isDir {
		return false
	}
	local := rel
	if p.base != "" {
		if rel != p.base && !strings.HasPrefix(rel, p.base+"/") {
			return false
		}
		if rel == p.base {
			return false
		}
		local = strings.TrimPrefix(rel, p.base+"/")
	}
	if local == "" {
		return false
	}
	if !p.anchored {
		return matchGlob(p.body, path.Base(local))
	}
	return matchGlob(p.body, local)
}

func parseIgnore(base, text string) []pattern {
	var out []pattern
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimRight(line, "\r")
		if line == "" || strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		negate := false
		if strings.HasPrefix(line, "!") {
			negate = true
			line = line[1:]
		}
		if line == "" || len(line) > 256 {
			continue
		}
		dirOnly := strings.HasSuffix(line, "/")
		if dirOnly {
			line = strings.TrimRight(line, "/")
		}
		anchored := strings.HasPrefix(line, "/") || strings.Contains(line, "/")
		line = strings.TrimPrefix(line, "/")
		if line == "" {
			continue
		}
		out = append(out, pattern{
			base:     base,
			body:     line,
			negate:   negate,
			dirOnly:  dirOnly,
			anchored: anchored,
		})
	}
	return out
}

func collectRules(root, dirRel string) []pattern {
	all := readIgnoreFile(root, root, "")
	if dirRel == "" {
		return all
	}
	acc := ""
	for _, part := range strings.Split(dirRel, "/") {
		if acc == "" {
			acc = part
		} else {
			acc += "/" + part
		}
		dir := filepath.Join(root, filepath.FromSlash(acc))
		all = append(all, readIgnoreFile(root, dir, acc)...)
	}
	return all
}

func readIgnoreFile(root, dir, base string) []pattern {
	candidate := filepath.Join(dir, ".gitignore")
	real, err := filepath.EvalSymlinks(candidate)
	if err != nil || !Within(root, real) {
		return nil
	}
	f, err := os.Open(real)
	if err != nil {
		return nil
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 256*1024 {
		return nil
	}
	body, err := io.ReadAll(io.LimitReader(f, 256*1024))
	if err != nil {
		return nil
	}
	return parseIgnore(base, string(body))
}

func matchGlob(pattern, name string) bool {
	return matchSegs(splitSlash(pattern), splitSlash(name))
}

func splitSlash(s string) []string {
	if s == "" {
		return nil
	}
	return strings.Split(s, "/")
}

func matchSegs(pat, name []string) bool {
	for len(pat) > 0 {
		if pat[0] == "**" {
			for len(pat) > 0 && pat[0] == "**" {
				pat = pat[1:]
			}
			if len(pat) == 0 {
				return true
			}
			for i := 0; i <= len(name); i++ {
				if matchSegs(pat, name[i:]) {
					return true
				}
			}
			return false
		}
		if len(name) == 0 || !matchOne(pat[0], name[0]) {
			return false
		}
		pat = pat[1:]
		name = name[1:]
	}
	return len(name) == 0
}

func matchOne(pat, s string) bool {
	var rec func(i, j int) bool
	rec = func(i, j int) bool {
		if i == len(pat) {
			return j == len(s)
		}
		if pat[i] == '*' {
			for k := j; k <= len(s); k++ {
				if rec(i+1, k) {
					return true
				}
			}
			return false
		}
		if j == len(s) {
			return false
		}
		if pat[i] == '?' || pat[i] == s[j] {
			return rec(i+1, j+1)
		}
		return false
	}
	return rec(0, 0)
}
