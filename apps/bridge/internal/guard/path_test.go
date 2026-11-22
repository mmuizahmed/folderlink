package guard

import "testing"

func TestWithinGeneric(t *testing.T) {
	cases := []struct {
		root, target, sep string
		fold              bool
		want              bool
	}{
		{root: "/proj", target: "/proj/a", sep: "/", want: true},
		{root: "/proj", target: "/proj", sep: "/", want: true},
		{root: "/proj/", target: "/proj/a/", sep: "/", want: true},
		{root: "/proj", target: "/proj-evil/a", sep: "/", want: false},
		{root: "/proj", target: "/etc/passwd", sep: "/", want: false},
		{root: "/proj", target: "/proj/../etc/passwd", sep: "/", want: false},
		{root: "/", target: "/etc/passwd", sep: "/", want: true},
		{root: `C:\Proj`, target: `c:\proj\a`, sep: `\`, fold: true, want: true},
		{root: `C:\Proj`, target: `D:\proj\a`, sep: `\`, fold: true, want: false},
		{root: `C:\foo`, target: `C:\foobar`, sep: `\`, fold: true, want: false},
		{root: `C:\foo`, target: `C:\foo`, sep: `\`, fold: true, want: true},
		{root: `\\srv\share\a`, target: `\\srv\share\a\b`, sep: `\`, fold: true, want: true},
		{root: `\\srv\share\a`, target: `\\srv\share\ab`, sep: `\`, fold: true, want: false},
		{root: `\\srv\share\a`, target: `\\files\share\a`, sep: `\`, fold: true, want: false},
		{root: `\\?\C:\foo`, target: `\\?\C:\foo\bar`, sep: `\`, fold: true, want: true},
		{root: `\\?\C:\foo`, target: `\\?\D:\foo\bar`, sep: `\`, fold: true, want: false},
		{root: "/proj", target: "", sep: "/", want: false},
	}
	for _, tc := range cases {
		if got := withinGeneric(tc.root, tc.target, tc.sep, tc.fold); got != tc.want {
			t.Errorf("within(%q, %q) = %v, want %v", tc.root, tc.target, got, tc.want)
		}
	}
}

func TestCleanRelative(t *testing.T) {
	ok, err := CleanRelative("a/b")
	if err != nil || ok != "a/b" {
		t.Fatalf("got %q %v", ok, err)
	}
	ok, err = CleanRelative(`a\b\c`)
	if err != nil || ok != "a/b/c" {
		t.Fatalf("backslash: got %q %v", ok, err)
	}
	_, err = CleanRelative("a/../../b")
	if err == nil || CodeOf(err) != "outside_root" {
		t.Fatalf("escape: %v", err)
	}
	ok, err = CleanRelative("a/../b")
	if err != nil || ok != "b" {
		t.Fatalf("inner parent: got %q %v", ok, err)
	}
	for _, bad := range []string{"/etc/passwd", `C:\Windows`, "file.txt:stream", "foo\x00bar", "CON", "aux.txt", "COM1", "a/NUL/b", "."} {
		if bad == "." {
			got, err := CleanRelative(bad)
			if err != nil || got != "" {
				t.Fatalf("dot: got %q %v", got, err)
			}
			continue
		}
		if _, err := CleanRelative(bad); err == nil {
			t.Fatalf("accepted %q", bad)
		}
	}
}
