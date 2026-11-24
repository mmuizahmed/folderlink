package guard

import (
	"strings"
	"testing"
)

func TestUnifiedDiffCreate(t *testing.T) {
	out := unifiedDiff("notes.md", nil, []string{"hello", "world"})
	if !strings.Contains(out, "--- a/notes.md") || !strings.Contains(out, "+++ b/notes.md") {
		t.Fatalf("missing headers in %q", out)
	}
	if !strings.Contains(out, "+hello") || !strings.Contains(out, "+world") {
		t.Fatalf("missing added lines in %q", out)
	}
	if strings.Contains(out, "\n-") {
		t.Fatalf("unexpected removal in %q", out)
	}
}

func TestUnifiedDiffChange(t *testing.T) {
	out := unifiedDiff(
		"notes.md",
		[]string{"one", "two", "three", "four", "five"},
		[]string{"one", "TWO", "three", "four", "five"},
	)
	if !strings.Contains(out, "-two") || !strings.Contains(out, "+TWO") {
		t.Fatalf("missing change in %q", out)
	}
	if !strings.Contains(out, " one") || !strings.Contains(out, " three") {
		t.Fatalf("missing context in %q", out)
	}
	if !strings.Contains(out, "@@ -1,5 +1,5 @@") {
		t.Fatalf("wrong hunk header in %q", out)
	}
}

func TestUnifiedDiffIdentical(t *testing.T) {
	out := unifiedDiff("notes.md", []string{"same"}, []string{"same"})
	if strings.Contains(out, "@@") {
		t.Fatalf("identical files should have no hunks, got %q", out)
	}
}

func TestUnifiedDiffTwoHunks(t *testing.T) {
	before := []string{"a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "a11", "a12"}
	after := []string{"A1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "a11", "A12"}
	out := unifiedDiff("f.txt", before, after)
	if strings.Count(out, "@@ -") != 2 {
		t.Fatalf("expected two hunks, got %q", out)
	}
	if !strings.Contains(out, "-a1") || !strings.Contains(out, "+A1") {
		t.Fatalf("missing first change in %q", out)
	}
	if !strings.Contains(out, "-a12") || !strings.Contains(out, "+A12") {
		t.Fatalf("missing second change in %q", out)
	}
}

func TestUnifiedDiffFallback(t *testing.T) {
	// 600 lines, all changed: 1200 edit steps, over the Myers cap, so
	// the prefix/suffix fallback runs. It must still show every removed
	// and added line.
	before := make([]string, 600)
	after := make([]string, 600)
	for i := range before {
		before[i] = "old line"
		after[i] = "new line"
	}
	out := unifiedDiff("big.txt", before, after)
	if !strings.Contains(out, "-old line") || !strings.Contains(out, "+new line") {
		t.Fatalf("fallback diff is missing lines: %q", out[:200])
	}
}

func TestDiffOpsRoundTrip(t *testing.T) {
	// Applying the edit script must turn before into after.
	cases := [][2][]string{
		{nil, []string{"x"}},
		{[]string{"x"}, nil},
		{[]string{"a", "b", "c"}, []string{"a", "c"}},
		{[]string{"a", "c"}, []string{"a", "b", "c"}},
		{[]string{"a", "b", "b", "c"}, []string{"a", "b", "c"}},
		{[]string{"one", "two", "three"}, []string{"one", "TWO", "three", "four"}},
	}
	for _, tc := range cases {
		ops := diffOps(tc[0], tc[1])
		var got []string
		for _, op := range ops {
			if op.kind == ' ' || op.kind == '+' {
				got = append(got, op.line)
			}
		}
		if strings.Join(got, "\n") != strings.Join(tc[1], "\n") {
			t.Fatalf("diffOps(%v, %v) applies to %v", tc[0], tc[1], got)
		}
		var gotBefore []string
		for _, op := range ops {
			if op.kind == ' ' || op.kind == '-' {
				gotBefore = append(gotBefore, op.line)
			}
		}
		if strings.Join(gotBefore, "\n") != strings.Join(tc[0], "\n") {
			t.Fatalf("diffOps(%v, %v) before-side is %v", tc[0], tc[1], gotBefore)
		}
	}
}
