// Package mode holds the bridge's write approval mode: how writes are
// gated. The mode is the top authority: it takes priority over per-tool
// defaults and over remember-rules (there are none in v1).
//
//   - ModeAI ("ai", the default): the connected app's own confirmation
//     card is the gate for normal writes. Dashboard pre-approval applies
//     only to high-risk ops: delete, exec, binary writes, executable
//     paths.
//   - ModeManual ("manual"): every write and exec needs the user's
//     manual approval in the dashboard. Neither a client card nor a
//     remember-rule bypasses the manual step.
//
// The worker is the source of truth (D1, set from the dashboard). The
// bridge learns the mode over the websocket — on hello, and live when it
// changes — and caches it in the local config file. A bridge with
// neither a sync nor a cache fails closed to manual: it is the safe mode,
// and a fresh bridge has nothing to lose by asking. A stale cache cannot
// wrongly permit a write in practice: no tool call reaches the bridge
// before hello, and hello re-syncs the mode first.
package mode

import "sync"

// Mode is a write approval mode.
type Mode string

const (
	// ModeAI is the default: the app's confirmation card gates normal writes.
	ModeAI Mode = "ai"
	// ModeManual means every write and exec needs a dashboard approval.
	ModeManual Mode = "manual"
)

// Parse returns the mode for a stored string, or false when it is not a
// known mode.
func Parse(s string) (Mode, bool) {
	switch Mode(s) {
	case ModeAI, ModeManual:
		return Mode(s), true
	default:
		return "", false
	}
}

// Store holds the current mode. The zero value is manual: fail closed
// until a mode is established.
type Store struct {
	mu     sync.RWMutex
	mode   Mode
	synced bool
}

// New returns a store seeded from the local cache. An unknown or empty
// cache means manual: fail closed.
func New(cached string) *Store {
	if m, ok := Parse(cached); ok {
		return &Store{mode: m}
	}
	return &Store{mode: ModeManual}
}

// Get returns the current mode.
func (s *Store) Get() Mode {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.mode
}

// Set applies a mode synced from the worker and marks the store synced.
func (s *Store) Set(m Mode) {
	s.mu.Lock()
	s.mode = m
	s.synced = true
	s.mu.Unlock()
}

// Synced reports whether the mode came from the worker this session,
// rather than the local cache.
func (s *Store) Synced() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.synced
}

// Label is the mode as the tray menu shows it.
func (m Mode) Label() string {
	if m == ModeManual {
		return "Manual approval"
	}
	return "AI approval"
}
