package guard

import (
	"fmt"
	"strings"
)

// unifiedDiff renders a unified diff of two line lists, with 3 lines of
// context, in the --- a/ +++ b/ form the dashboard shows. The diff is
// computed from the exact bytes that will be written, and the approval
// token binds to its hash — so what the user reviews is what executes.
//
// The core is Myers' O(ND) algorithm with backtracking. Two caps keep it
// bounded: the trace only stores the k-range each step actually used
// (O(D²) memory, not O(D·N)), and a diff needing more than maxDiffSteps
// edit steps falls back to a prefix/suffix diff — still correct, just one
// hunk instead of many.
const (
	diffContext  = 3
	maxDiffSteps = 512
)

type diffOp struct {
	kind byte // ' ' equal, '-' removed, '+' added
	line string
}

// unifiedDiff renders the diff, capped at MaxDiffBytes.
func unifiedDiff(rel string, before, after []string) string {
	ops := diffOps(before, after)
	var b strings.Builder
	fmt.Fprintf(&b, "--- a/%s\n", rel)
	fmt.Fprintf(&b, "+++ b/%s\n", rel)
	for _, hunk := range hunks(ops) {
		fmt.Fprintf(&b, "@@ -%s +%s @@\n", hunkRange(hunk.beforeStart, hunk.beforeCount),
			hunkRange(hunk.afterStart, hunk.afterCount))
		for _, op := range hunk.ops {
			b.WriteByte(op.kind)
			b.WriteString(op.line)
			b.WriteByte('\n')
		}
	}
	out := b.String()
	if len(out) > MaxDiffBytes {
		out = out[:MaxDiffBytes] + "\n... (diff truncated)\n"
	}
	return out
}

func hunkRange(start, count int) string {
	if count == 1 {
		return fmt.Sprintf("%d", start)
	}
	return fmt.Sprintf("%d,%d", start, count)
}

type diffHunk struct {
	beforeStart, beforeCount int
	afterStart, afterCount   int
	ops                      []diffOp
}

// hunks groups ops into hunks with diffContext lines of context, merging
// hunks whose context overlaps.
func hunks(ops []diffOp) []diffHunk {
	type region struct{ start, end int }
	var regions []region
	i := 0
	for i < len(ops) {
		// Skip equal lines to the next change.
		for i < len(ops) && ops[i].kind == ' ' {
			i++
		}
		if i >= len(ops) {
			break
		}
		start := i - diffContext
		if start < 0 {
			start = 0
		}
		lastChange := i
		j := i
		for j < len(ops) {
			if ops[j].kind != ' ' {
				lastChange = j
				j++
				continue
			}
			// An equal run longer than twice the context ends the hunk;
			// a shorter one stays inside it.
			k := j
			for k < len(ops) && ops[k].kind == ' ' {
				k++
			}
			if k-j > 2*diffContext {
				break
			}
			j = k
		}
		end := lastChange + 1 + diffContext
		if end > len(ops) {
			end = len(ops)
		}
		if n := len(regions); n > 0 && start <= regions[n-1].end {
			// Overlapping context: merge into the previous hunk.
			if end > regions[n-1].end {
				regions[n-1].end = end
			}
		} else {
			regions = append(regions, region{start, end})
		}
		i = j
	}
	out := make([]diffHunk, 0, len(regions))
	for _, r := range regions {
		hunkOps := ops[r.start:r.end]
		beforeStart, beforeCount, afterStart, afterCount := hunkPosition(ops, r.start, hunkOps)
		out = append(out, diffHunk{
			beforeStart: beforeStart, beforeCount: beforeCount,
			afterStart: afterStart, afterCount: afterCount,
			ops: hunkOps,
		})
	}
	return out
}

// hunkPosition computes the 1-based start lines and counts for a hunk.
func hunkPosition(ops []diffOp, start int, hunkOps []diffOp) (int, int, int, int) {
	beforeStart, afterStart := 1, 1
	for _, op := range ops[:start] {
		switch op.kind {
		case ' ', '-':
			beforeStart++
		}
		switch op.kind {
		case ' ', '+':
			afterStart++
		}
	}
	beforeCount, afterCount := 0, 0
	for _, op := range hunkOps {
		switch op.kind {
		case ' ', '-':
			beforeCount++
		}
		switch op.kind {
		case ' ', '+':
			afterCount++
		}
	}
	return beforeStart, beforeCount, afterStart, afterCount
}

// diffOps returns the minimal edit script, or a prefix/suffix script when
// the minimal one would need more than maxDiffSteps steps.
func diffOps(before, after []string) []diffOp {
	n, m := len(before), len(after)
	if n == 0 && m == 0 {
		return nil
	}
	if ops, ok := myers(before, after); ok {
		return ops
	}
	return fallbackDiff(before, after)
}

// myers runs the greedy algorithm and backtracks. It reports false when
// the diff needs more than maxDiffSteps edit steps.
func myers(before, after []string) ([]diffOp, bool) {
	n, m := len(before), len(after)
	max := n + m
	if max == 0 {
		return nil, true
	}
	offset := max
	v := make([]int, 2*max+1)
	// trace[d] holds V after d steps, for k in [-d, d], indexed by k+d.
	var trace [][]int
	found := -1
outer:
	for d := 0; d <= max; d++ {
		if d > maxDiffSteps {
			return nil, false
		}
		for k := -d; k <= d; k += 2 {
			var x int
			if k == -d || (k != d && v[offset+k-1] < v[offset+k+1]) {
				x = v[offset+k+1]
			} else {
				x = v[offset+k-1] + 1
			}
			y := x - k
			for x < n && y < m && before[x] == after[y] {
				x++
				y++
			}
			v[offset+k] = x
			if x >= n && y >= m {
				found = d
				break outer
			}
		}
		snap := make([]int, 2*d+1)
		for k := -d; k <= d; k++ {
			snap[k+d] = v[offset+k]
		}
		trace = append(trace, snap)
	}
	if found < 0 {
		return nil, false
	}
	// Backtrack from (n, m). At step d the diagonal k has the same parity
	// as d, so the edge cases are exact: k == -d came from a down move,
	// k == d from a right move; anything else compares the two
	// predecessors, both of which exist in the step d-1 snapshot.
	var ops []diffOp
	x, y := n, m
	for d := found; d > 0; d-- {
		vd := trace[d-1]
		k := x - y
		var down bool
		switch {
		case k == -d:
			down = true
		case k == d:
			down = false
		default:
			down = vd[k-1+d-1] < vd[k+1+d-1]
		}
		var prevK int
		if down {
			prevK = k + 1
		} else {
			prevK = k - 1
		}
		prevX := vd[prevK+d-1]
		prevY := prevX - prevK
		editX, editY := prevX, prevY
		if down {
			editY++
		} else {
			editX++
		}
		for x > editX && y > editY {
			ops = append(ops, diffOp{' ', before[x-1]})
			x--
			y--
		}
		if down {
			ops = append(ops, diffOp{'+', after[y-1]})
			y--
		} else {
			ops = append(ops, diffOp{'-', before[x-1]})
			x--
		}
	}
	for x > 0 && y > 0 {
		ops = append(ops, diffOp{' ', before[x-1]})
		x--
		y--
	}
	// ops was built backwards; reverse it.
	for i, j := 0, len(ops)-1; i < j; i, j = i+1, j-1 {
		ops[i], ops[j] = ops[j], ops[i]
	}
	return ops, true
}

// fallbackDiff is the prefix/suffix diff: common head and tail, one
// removed block and one added block in the middle. Always correct, just
// coarser than Myers.
func fallbackDiff(before, after []string) []diffOp {
	prefix := 0
	for prefix < len(before) && prefix < len(after) && before[prefix] == after[prefix] {
		prefix++
	}
	suffix := 0
	for suffix < len(before)-prefix && suffix < len(after)-prefix &&
		before[len(before)-1-suffix] == after[len(after)-1-suffix] {
		suffix++
	}
	var ops []diffOp
	for _, line := range before[:prefix] {
		ops = append(ops, diffOp{' ', line})
	}
	for _, line := range before[prefix : len(before)-suffix] {
		ops = append(ops, diffOp{'-', line})
	}
	for _, line := range after[prefix : len(after)-suffix] {
		ops = append(ops, diffOp{'+', line})
	}
	for _, line := range before[len(before)-suffix:] {
		ops = append(ops, diffOp{' ', line})
	}
	return ops
}
