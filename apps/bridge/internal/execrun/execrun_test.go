package execrun

import (
	"strings"
	"testing"
	"time"
)

func TestValidate(t *testing.T) {
	ok := [][]string{
		{"git", "status"},
		{"git", "log", "--oneline", "-5"},
		{"node", "--version"},
		{"npm", "test"},
		{"python3", "-c", "print(1)"},
	}
	for _, argv := range ok {
		if err := Validate(argv); err != nil {
			t.Errorf("Validate(%v) = %v, want nil", argv, err)
		}
	}
	denied := [][]string{
		nil,
		{},
		{"rm", "-rf", "/"},
		{"bash", "-c", "echo hi"},
		{"/usr/bin/git", "status"},
		{"git", "-c", "core.sshCommand=evil", "status"},
		{"git", "--config", "x=y"},
		{"git", "-C", "/etc", "status"},
		{"git", "--git-dir=/etc", "status"},
		{"git", "clone", "--upload-pack", "evil", "x"},
		{"git", "clone", "--receive-pack", "evil", "x"},
		{"git", "status", strings.Repeat("a", MaxArgLen+1)},
	}
	for _, argv := range denied {
		if err := Validate(argv); err == nil {
			t.Errorf("Validate(%v) = nil, want an error", argv)
		}
	}
	many := []string{"git", "status"}
	for len(many) <= MaxArgv {
		many = append(many, "x")
	}
	if err := Validate(many); err == nil {
		t.Errorf("Validate(%d args) = nil, want an error", len(many))
	}
}

func TestArgvHash(t *testing.T) {
	a := ArgvHash([]string{"git", "status"})
	if a == ArgvHash([]string{"git", "statu"}) {
		t.Fatal("ArgvHash collides on different argv")
	}
	if a != ArgvHash([]string{"git", "status"}) {
		t.Fatal("ArgvHash is not deterministic")
	}
}

func TestStartAndPoll(t *testing.T) {
	r := NewRegistry()
	dir := t.TempDir()
	id, err := r.Start(dir, []string{"go", "version"})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !strings.HasPrefix(id, "exec_") {
		t.Fatalf("execution id = %q, want exec_ prefix", id)
	}
	if res, ok := r.Poll(id); !ok || res.Status != "running" && res.Status != "done" {
		t.Fatalf("Poll while starting = %+v, %v", res, ok)
	}
	deadline := time.Now().Add(10 * time.Second)
	var res Result
	for {
		var ok bool
		res, ok = r.Poll(id)
		if !ok {
			t.Fatal("Poll lost the session")
		}
		if res.Status != "running" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("go version did not finish in 10s")
		}
		time.Sleep(50 * time.Millisecond)
	}
	if res.Status != "done" || res.ExitCode != 0 {
		t.Fatalf("result = %+v", res)
	}
	if !strings.Contains(res.Stdout, "go version") {
		t.Fatalf("stdout = %q", res.Stdout)
	}
	if _, ok := r.Poll("exec_doesnotexist"); ok {
		t.Fatal("Poll succeeded for an unknown id")
	}
}

func TestStartFailure(t *testing.T) {
	r := NewRegistry()
	dir := t.TempDir()
	// A command that exits non-zero reports failed with its exit code.
	id, err := r.Start(dir, []string{"git", "rev-parse", "--verify", "no-such-ref-xyz"})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		res, ok := r.Poll(id)
		if !ok {
			t.Fatal("Poll lost the session")
		}
		if res.Status != "running" {
			if res.Status != "failed" || res.ExitCode == 0 {
				t.Fatalf("result = %+v, want failed with a non-zero exit", res)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("git did not finish in 10s")
		}
		time.Sleep(50 * time.Millisecond)
	}
	// A disallowed command never starts.
	if _, err := r.Start(dir, []string{"rm", "-rf", "/"}); err == nil {
		t.Fatal("Start accepted a disallowed command")
	}
}

func TestTimeout(t *testing.T) {
	old := Timeout
	Timeout = 100 * time.Millisecond
	defer func() { Timeout = old }()
	r := NewRegistry()
	id, err := r.Start(t.TempDir(), []string{"node", "-e", "setTimeout(function(){}, 10000)"})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		res, ok := r.Poll(id)
		if !ok {
			t.Fatal("Poll lost the session")
		}
		if res.Status != "running" {
			if res.Status != "timeout" {
				t.Fatalf("result = %+v, want timeout", res)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("command did not time out in 10s")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestOutputCap(t *testing.T) {
	r := NewRegistry()
	// Print 200KB: over the 64KB cap, so the result is truncated.
	id, err := r.Start(t.TempDir(), []string{"node", "-e", "process.stdout.write('x'.repeat(200*1024))"})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		res, ok := r.Poll(id)
		if !ok {
			t.Fatal("Poll lost the session")
		}
		if res.Status != "running" {
			if res.Status != "done" {
				t.Fatalf("result = %+v", res)
			}
			if !res.Truncated || len(res.Stdout) != MaxOutputBytes {
				t.Fatalf("stdout len = %d, truncated = %v", len(res.Stdout), res.Truncated)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("node did not finish in 10s")
		}
		time.Sleep(20 * time.Millisecond)
	}
}
