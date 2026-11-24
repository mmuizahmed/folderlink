// Package execrun runs dashboard-approved commands without a shell:
// argv exec only, a fixed command allowlist, a fixed working directory
// inside an approved folder, a scrubbed environment, a hard timeout, and
// capped output. Output is treated as data: it is returned to the AI,
// never executed.
//
// The timeout kills the direct process only. A command that spawns its
// own long-lived children (npm, git hooks) can leave those behind; the
// dashboard approval is the gate, and the 120s cap bounds the direct
// process.
package execrun

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// MaxArgv is the most arguments a command may carry, command included.
const MaxArgv = 32

// MaxArgLen is the longest a single argument may be.
const MaxArgLen = 1024

// Timeout is the hard wall-clock limit for a command.
var Timeout = 120 * time.Second

// MaxOutputBytes is the per-stream output cap.
const MaxOutputBytes = 64 * 1024

// SessionLifetime is how long a finished command's output is kept for
// exec_poll.
var SessionLifetime = 10 * time.Minute

// AllowedCommands is the fixed allowlist of bare command names. Nothing
// else runs, ever: no paths, no shell builtins, no .cmd/.bat files
// addressed directly. On Windows the allowlisted tools are resolved via
// PATH, which is how npm/npx/pnpm (their .cmd shims) work; the Windows
// metacharacter check below is what keeps those shims safe.
var AllowedCommands = map[string]bool{
	"git":     true,
	"node":    true,
	"npm":     true,
	"npx":     true,
	"pnpm":    true,
	"go":      true,
	"python":  true,
	"python3": true,
	"cargo":   true,
	"make":    true,
}

// gitDeniedArgs are git flags that escape the approved folder or turn
// git into an arbitrary-command runner. -c/--config can set
// core.sshCommand or core.fsmonitor (RCE); -C/--git-dir/--work-tree move
// the operation outside the folder; --upload-pack/--receive-pack run an
// arbitrary command on the remote side.
var gitDeniedArgs = map[string]bool{
	"-c": true, "--config": true,
	"-C": true, "--git-dir": true, "--work-tree": true,
	"-u": true, "--upload-pack": true, "--receive-pack": true,
}

var gitDeniedPrefixes = []string{"--config=", "--git-dir=", "--work-tree="}

// ArgvHash binds an approval token to the exact command line.
func ArgvHash(argv []string) string {
	sum := sha256.Sum256([]byte(strings.Join(argv, "\x00")))
	return hex.EncodeToString(sum[:])
}

// Validate checks the command and arguments before anything runs. It
// does not check whether the command exists on PATH — that is found out
// at Start time.
func Validate(argv []string) error {
	if len(argv) == 0 {
		return errors.New("empty command")
	}
	if len(argv) > MaxArgv {
		return fmt.Errorf("too many arguments (max %d)", MaxArgv)
	}
	cmd := argv[0]
	if !AllowedCommands[cmd] {
		return fmt.Errorf("command %q is not allowed", cmd)
	}
	for _, arg := range argv[1:] {
		if len(arg) > MaxArgLen {
			return fmt.Errorf("argument too long (max %d bytes)", MaxArgLen)
		}
		if strings.ContainsRune(arg, 0) {
			return errors.New("argument contains a NUL byte")
		}
	}
	if cmd == "git" {
		for _, arg := range argv[1:] {
			if gitDeniedArgs[arg] {
				return fmt.Errorf("git argument %q is not allowed", arg)
			}
			for _, prefix := range gitDeniedPrefixes {
				if strings.HasPrefix(arg, prefix) {
					return fmt.Errorf("git argument %q is not allowed", arg)
				}
			}
		}
	}
	if runtime.GOOS == "windows" {
		// Go runs .cmd/.bat shims (npm, npx, pnpm) via cmd.exe, so a
		// metacharacter in an argument would be interpreted by the
		// shell. Reject them outright.
		for _, arg := range argv {
			if strings.ContainsAny(arg, "&|<>^%") {
				return fmt.Errorf("argument %q contains a shell metacharacter", arg)
			}
			for _, r := range arg {
				if r < 0x20 {
					return fmt.Errorf("argument %q contains a control character", arg)
				}
			}
		}
	}
	return nil
}

// Result is the state of a command, as exec_poll reports it.
type Result struct {
	Status    string // running | done | failed | timeout
	ExitCode  int    // -1 while running or when killed
	Stdout    string
	Stderr    string
	Truncated bool
}

type session struct {
	mu      sync.Mutex
	done    chan struct{}
	result  Result
	created time.Time
}

// Registry tracks running and finished commands by execution id.
type Registry struct {
	mu       sync.Mutex
	sessions map[string]*session
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry {
	return &Registry{sessions: make(map[string]*session)}
}

// Start validates and starts a command in dir, returning its execution
// id. The command runs in the background; Poll reports its state.
func (r *Registry) Start(dir string, argv []string) (string, error) {
	if err := Validate(argv); err != nil {
		return "", err
	}
	id := "exec_" + randomHex(8)
	ctx, cancel := context.WithTimeout(context.Background(), Timeout)
	//nolint:gosec // The command is not tainted input: Validate allowlists
	// the bare command name and rejects shell metacharacters, and the
	// call only runs after a dashboard approval. This is the feature.
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Dir = dir
	cmd.Env = minimalEnv()
	out := &cappedBuffer{limit: MaxOutputBytes}
	errBuf := &cappedBuffer{limit: MaxOutputBytes}
	cmd.Stdout = out
	cmd.Stderr = errBuf
	if err := cmd.Start(); err != nil {
		cancel()
		return "", err
	}
	s := &session{done: make(chan struct{}), created: time.Now()}
	s.result = Result{Status: "running", ExitCode: -1}
	r.mu.Lock()
	r.sweepLocked()
	r.sessions[id] = s
	r.mu.Unlock()
	go func() {
		defer cancel()
		err := cmd.Wait()
		res := Result{
			Stdout:    toValidUTF8(out.String()),
			Stderr:    toValidUTF8(errBuf.String()),
			Truncated: out.truncated || errBuf.truncated,
		}
		switch {
		case ctx.Err() == context.DeadlineExceeded:
			res.Status = "timeout"
			res.ExitCode = -1
		case err == nil:
			res.Status = "done"
			res.ExitCode = 0
		default:
			res.Status = "failed"
			var exitErr *exec.ExitError
			if errors.As(err, &exitErr) {
				res.ExitCode = exitErr.ExitCode()
			} else {
				res.ExitCode = -1
			}
		}
		s.mu.Lock()
		s.result = res
		close(s.done)
		s.mu.Unlock()
	}()
	return id, nil
}

// Poll returns the current state of a command. While it is running,
// only the status is reported — no partial output, because the writer
// goroutine owns the buffers until the process exits. The second return
// is false for an unknown or expired execution id.
func (r *Registry) Poll(id string) (Result, bool) {
	r.mu.Lock()
	s, ok := r.sessions[id]
	r.mu.Unlock()
	if !ok {
		return Result{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.result.Status == "running" {
		return Result{Status: "running", ExitCode: -1}, true
	}
	return s.result, true
}

// sweepLocked drops finished sessions older than SessionLifetime. The
// caller must hold the lock.
func (r *Registry) sweepLocked() {
	now := time.Now()
	for id, s := range r.sessions {
		s.mu.Lock()
		finished := s.result.Status != "running"
		created := s.created
		s.mu.Unlock()
		if finished && now.Sub(created) > SessionLifetime {
			delete(r.sessions, id)
		}
	}
}

// cappedBuffer keeps at most limit bytes and records truncation.
type cappedBuffer struct {
	buf       bytes.Buffer
	limit     int
	truncated bool
}

func (w *cappedBuffer) Write(p []byte) (int, error) {
	if w.buf.Len() >= w.limit {
		w.truncated = true
		return len(p), nil
	}
	room := w.limit - w.buf.Len()
	if len(p) > room {
		w.buf.Write(p[:room])
		w.truncated = true
	} else {
		w.buf.Write(p)
	}
	return len(p), nil
}

func (w *cappedBuffer) String() string { return w.buf.String() }

// minimalEnv is the scrubbed environment a command runs with: PATH and
// the bare minimum the OS needs, nothing inherited (no tokens, no
// secrets, no FOLDERLINK_*).
func minimalEnv() []string {
	env := []string{"PATH=" + os.Getenv("PATH")}
	if runtime.GOOS == "windows" {
		for _, key := range []string{"SystemRoot", "TEMP", "TMP", "USERPROFILE", "PATHEXT"} {
			if v := os.Getenv(key); v != "" {
				env = append(env, key+"="+v)
			}
		}
	} else {
		for _, key := range []string{"HOME", "USER", "LANG", "LC_ALL"} {
			if v := os.Getenv(key); v != "" {
				env = append(env, key+"="+v)
			}
		}
		if os.Getenv("LANG") == "" {
			env = append(env, "LANG=C.UTF-8")
		}
	}
	return env
}

func toValidUTF8(s string) string {
	if utf8.ValidString(s) {
		return s
	}
	return strings.ToValidUTF8(s, "�")
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return ""
	}
	return hex.EncodeToString(b)
}
