// Package approve holds the bridge side of the two-turn approval flow:
// pending requests the dashboard shows, and the single-use tokens minted
// when the user approves.
//
// Nothing here ever leaves the bridge. The token is a random 256-bit
// value held in memory, indexed by request id, and the AI only ever
// presents the request id. The token's job is binding (the hashes it was
// minted for) and single-use, not authentication — the websocket channel
// is already authenticated by the device key, and the dashboard approval
// is what authorizes the operation. The worker and D1 are transport and
// record-keeping only.
package approve

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

// Op is a dashboard-gated operation.
type Op string

const (
	OpWriteFile  Op = "write_file"
	OpDeleteFile Op = "delete_file"
	OpRunCommand Op = "run_command"
)

// PendingRequestLifetime is how long a dashboard approval request lives
// before it expires as denied. 24 hours, per the user's decision: long
// enough for the user to see the AI's message and open the dashboard
// whenever they get to it, and the bridge token's own 10-minute window
// still bounds the dangerous part (the gap between approval and use).
var PendingRequestLifetime = 24 * time.Hour

// TokenLifetime is the window between dashboard approval and the second
// tool call.
var TokenLifetime = 10 * time.Minute

// Pending is a dashboard approval request: what the AI asked to do, and
// the bridge-computed evidence the dashboard shows. The content itself
// is never stored — only its hash.
type Pending struct {
	ID          string
	Op          Op
	FolderID    string
	FolderLabel string
	Path        string
	// ContentHash is the SHA-256 of the exact bytes to write (write), the
	// SHA-256 of the bytes being deleted (delete), or "" (exec).
	ContentHash string
	// PreHash is the SHA-256 of the file before the operation, or
	// "absent" for a new file (write), "" (exec).
	PreHash string
	// Diff is the bridge-computed unified diff (text write) or a
	// size/hash summary (binary write, large file).
	Diff string
	// Preview is the first-lines preview of a file about to be deleted.
	Preview string
	// Size is the size of the file about to be deleted, or -1.
	Size int64
	// Argv is the exact command line for exec.
	Argv []string
	// ArgvHash binds the exec token to the exact argv.
	ArgvHash  string
	CreatedAt time.Time
	ExpiresAt time.Time
}

type token struct {
	// value is the random token. It is never sent anywhere: the request
	// id is the handle, and this value existing in memory is what makes
	// the approval unforgeable from outside the bridge.
	value       string
	op          Op
	folderID    string
	path        string
	contentHash string
	preHash     string
	argvHash    string
	expiresAt   time.Time
}

// Binding is what the second tool call must match for the token to be
// honored. Every field is recomputed from the live file and the
// re-sent arguments at verification time.
type Binding struct {
	Op          Op
	FolderID    string
	Path        string
	ContentHash string
	PreHash     string
	ArgvHash    string
}

// Store holds pending requests and minted tokens in bridge memory. A
// bridge restart forgets them all: pending dashboard rows then fail
// closed (the worker marks them expired when approval is attempted).
type Store struct {
	mu      sync.Mutex
	pending map[string]*Pending
	tokens  map[string]*token
}

// New returns an empty store.
func New() *Store {
	return &Store{
		pending: make(map[string]*Pending),
		tokens:  make(map[string]*token),
	}
}

// Create records a pending request, assigning its id and expiry.
func (s *Store) Create(p *Pending) *Pending {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked()
	p.ID = newRequestID()
	p.CreatedAt = time.Now()
	p.ExpiresAt = p.CreatedAt.Add(PendingRequestLifetime)
	if p.Op != OpDeleteFile {
		p.Size = -1
	}
	s.pending[p.ID] = p
	return p
}

// Get returns a pending request that is still live, or nil.
func (s *Store) Get(id string) *Pending {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked()
	return s.pending[id]
}

// Approve mints the single-use token for a pending request. It returns
// false when the request is unknown, expired, or already decided: the
// dashboard must then show the request as gone.
func (s *Store) Approve(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked()
	p, ok := s.pending[id]
	if !ok {
		return false
	}
	delete(s.pending, id)
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return false
	}
	s.tokens[id] = &token{
		value:       hex.EncodeToString(value),
		op:          p.Op,
		folderID:    p.FolderID,
		path:        p.Path,
		contentHash: p.ContentHash,
		preHash:     p.PreHash,
		argvHash:    p.ArgvHash,
		expiresAt:   time.Now().Add(TokenLifetime),
	}
	return true
}

// Deny drops a pending request. It returns false when the request is
// unknown or already decided.
func (s *Store) Deny(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked()
	if _, ok := s.pending[id]; !ok {
		return false
	}
	delete(s.pending, id)
	return true
}

// Verify consumes the token for id and checks the binding. It returns
// false, with a reason, when there is no token, it expired, or the
// binding does not match. The token is consumed on ANY attempt, including
// a failed one: a failed verification burns the token, forcing a fresh
// approval, which closes the retry-the-same-token-after-tampering hole.
// A "no_token" reason means no approval was minted: the caller should
// check whether the request is still pending (approval_required) or gone
// (approval_denied). Verify does not sweep expired tokens first, so an
// expired token is reported as approval_expired instead of no_token.
func (s *Store) Verify(id string, binding Binding) (bool, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	tok, ok := s.tokens[id]
	if !ok {
		return false, "no_token"
	}
	delete(s.tokens, id)
	if time.Now().After(tok.expiresAt) {
		return false, "approval_expired"
	}
	if tok.op != binding.Op || tok.folderID != binding.FolderID || tok.path != binding.Path ||
		tok.contentHash != binding.ContentHash || tok.preHash != binding.PreHash ||
		tok.argvHash != binding.ArgvHash {
		return false, "hash_mismatch"
	}
	return true, ""
}

// sweepLocked drops expired pending requests and tokens. The caller
// must hold the lock. Verify does not call it: an expired token must be
// reported as approval_expired, not swept away first.
func (s *Store) sweepLocked() {
	now := time.Now()
	for id, p := range s.pending {
		if now.After(p.ExpiresAt) {
			delete(s.pending, id)
		}
	}
	for id, tok := range s.tokens {
		if now.After(tok.expiresAt) {
			delete(s.tokens, id)
		}
	}
}

// newRequestID returns a random v4 UUID: the approval id the AI carries
// between the two calls.
func newRequestID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand failing is fatal to the approval flow; fall back
		// to a zero id the worker will reject as malformed.
		return "00000000-0000-0000-0000-000000000000"
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
