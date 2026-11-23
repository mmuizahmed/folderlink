package guard

import "testing"

func TestGitignoreSubset(t *testing.T) {
	pats := parseIgnore("", `
# comment
*.log
!keep.log
/only-root.txt
build/
docs/*.md
secret/
`)
	if ignored("dir/a.log", false, pats) {
		// last relevant match is *.log, and keep.log does not apply
	} else {
		t.Fatal("expected dir/a.log to be ignored")
	}
	if ignored("keep.log", false, pats) {
		t.Fatal("negation should keep keep.log")
	}
	if ignored("dir/keep.log", false, pats) {
		t.Fatal("negation should keep dir/keep.log")
	}
	if !ignored("only-root.txt", false, pats) {
		t.Fatal("anchored only-root.txt")
	}
	if ignored("dir/only-root.txt", false, pats) {
		t.Fatal("anchored pattern should not match a nested file")
	}
	if !ignored("build", true, pats) {
		t.Fatal("build directory")
	}
	if ignored("build", false, pats) {
		t.Fatal("build file is not a directory pattern")
	}
	if !ignored("docs/a.md", false, pats) {
		t.Fatal("docs/*.md")
	}
	if ignored("docs/sub/a.md", false, pats) {
		t.Fatal("docs/*.md should be one level")
	}
	if !ignored("secret/a.txt", false, pats) {
		t.Fatal("excluding a directory excludes its children")
	}
}

func TestGlobStars(t *testing.T) {
	if !matchGlob("**/*.txt", "a/b/c.txt") {
		t.Fatal("double star")
	}
	if !matchGlob("logs/**/*.txt", "logs/a.txt") {
		t.Fatal("double star may be empty")
	}
	if matchGlob("logs/*.txt", "logs/a/b.txt") {
		t.Fatal("single star does not cross a slash")
	}
}
