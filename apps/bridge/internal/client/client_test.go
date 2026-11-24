package client

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/browser"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/config"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/identity"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/protocol"
)

func TestRunAnswersReadAndRejectsEscape(t *testing.T) {
	browserOpen := browser.Open
	browser.Open = func(string) error { return nil }
	t.Cleanup(func() { browser.Open = browserOpen })
	home := t.TempDir()
	project := t.TempDir()
	if err := os.WriteFile(project+"/hello.txt", []byte("hello from the bridge"), 0o600); err != nil {
		t.Fatal(err)
	}
	id, err := identity.LoadOrCreate(home)
	if err != nil {
		t.Fatal(err)
	}
	store, err := config.Open(home)
	if err != nil {
		t.Fatal(err)
	}
	folder, err := store.Allow(project, "notes")
	if err != nil {
		t.Fatal(err)
	}

	var mu sync.Mutex
	var pub ed25519.PublicKey
	paired := false
	results := make(chan string, 2)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/pair/status":
			mu.Lock()
			ok := paired
			mu.Unlock()
			if !ok {
				http.NotFound(w, r)
				return
			}
			writeJSON(t, w, map[string]string{"state": "active"})
		case r.URL.Path == "/api/pair/begin":
			body := readSigned(t, r)
			key, err := base64.RawURLEncoding.DecodeString(body.publicKey)
			if err != nil {
				t.Errorf("public key: %v", err)
				http.Error(w, "bad key", http.StatusBadRequest)
				return
			}
			if err := protocol.VerifyPayload(ed25519.PublicKey(key), body.payload, body.sig); err != nil {
				t.Errorf("begin signature: %v", err)
				http.Error(w, "bad sig", http.StatusUnauthorized)
				return
			}
			mu.Lock()
			pub = key
			paired = true
			mu.Unlock()
			writeJSON(t, w, map[string]string{
				"code":      "AB3D-EF2H",
				"expiresAt": time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339),
			})
		case strings.HasSuffix(r.URL.Path, "/ws"):
			conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
			if err != nil {
				return
			}
			defer func() { _ = conn.Close(websocket.StatusNormalClosure, "") }()
			ctx := r.Context()
			_, data, err := conn.Read(ctx)
			if err != nil {
				return
			}
			msg, err := protocol.Parse(data)
			if err != nil || msg.Type != protocol.TypeHello {
				t.Errorf("hello: %v", err)
				return
			}
			mu.Lock()
			key := append(ed25519.PublicKey(nil), pub...)
			mu.Unlock()
			if err := protocol.VerifyPayload(key, msg.Payload, msg.Sig); err != nil {
				t.Errorf("hello signature: %v", err)
				return
			}
			ack, _ := json.Marshal(map[string]any{"ok": true, "heartbeatSec": 20, "approvedFolderIds": []string{folder.ID}})
			reply := protocol.Message{V: 1, Type: protocol.TypeHelloAck, ID: msg.ID, Payload: ack}
			raw, _ := reply.Marshal()
			if err := conn.Write(ctx, websocket.MessageText, raw); err != nil {
				return
			}
			ask := func(id, path string) {
				payload, _ := json.Marshal(map[string]any{"op": "read_file", "folderId": folder.ID, "path": path})
				req := protocol.Message{V: 1, Type: protocol.TypeRequest, ID: id, Payload: payload}
				encoded, _ := req.Marshal()
				_ = conn.Write(ctx, websocket.MessageText, encoded)
			}
			ask("good", "hello.txt")
			ask("bad", "../secret.txt")
			got := 0
			for got < 2 {
				_, data, err := conn.Read(ctx)
				if err != nil {
					return
				}
				msg, err := protocol.Parse(data)
				if err != nil || msg.Type == protocol.TypePing {
					continue
				}
				results <- msg.ID + " " + string(msg.Payload)
				got++
			}
			<-ctx.Done()
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	done := make(chan struct{})
	go func() {
		_ = Run(ctx, Config{
			Server:       srv.URL,
			Web:          "http://localhost:5173",
			Name:         "test",
			Version:      "test",
			Identity:     id,
			Store:        store,
			PollInterval: 20 * time.Millisecond,
			Heartbeat:    time.Hour,
			IdleTimeout:  time.Hour,
			Backoff:      func(int) time.Duration { return 10 * time.Millisecond },
			Stdout:       ioDiscard{},
		})
		close(done)
	}()

	seen := map[string]string{}
	timeout := time.After(7 * time.Second)
	for len(seen) < 2 {
		select {
		case item := <-results:
			id, body, _ := strings.Cut(item, " ")
			seen[id] = body
		case <-timeout:
			t.Fatalf("timed out, saw %#v", seen)
		}
	}
	if !strings.Contains(seen["good"], "hello from the bridge") || !strings.Contains(seen["good"], `"ok":true`) {
		t.Fatalf("good read: %s", seen["good"])
	}
	if strings.Contains(seen["bad"], "hello from the bridge") || strings.Contains(seen["bad"], `"ok":true`) {
		t.Fatalf("escape read: %s", seen["bad"])
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("bridge did not stop")
	}
}

func TestFolderSnapshot(t *testing.T) {
	home := t.TempDir()
	store, err := config.Open(home)
	if err != nil {
		t.Fatal(err)
	}
	cfg := Config{Store: store}
	// No folders yet: an empty snapshot, readable.
	snap, ok := folderSnapshot(cfg)
	if !ok || len(snap) != 0 {
		t.Fatalf("folderSnapshot empty store = %v, %v; want [], true", snap, ok)
	}
	// Adding a folder changes the snapshot.
	one := t.TempDir()
	folder, err := store.Allow(one, "one")
	if err != nil {
		t.Fatal(err)
	}
	snap, ok = folderSnapshot(cfg)
	if !ok || len(snap) != 1 {
		t.Fatalf("folderSnapshot after allow = %v, %v; want 1 entry, true", snap, ok)
	}
	// A rename changes the snapshot; a mode-cache write does not.
	if err := store.Rename(folder.ID, "uno"); err != nil {
		t.Fatal(err)
	}
	renamed, ok := folderSnapshot(cfg)
	if !ok || len(renamed) != 1 || string(renamed[0]) == string(snap[0]) {
		t.Fatalf("folderSnapshot after rename = %v, %v; want 1 changed entry", renamed, ok)
	}
	if err := store.SetWriteApprovalMode("manual"); err != nil {
		t.Fatal(err)
	}
	same, ok := folderSnapshot(cfg)
	if !ok || len(same) != 1 || string(same[0]) != string(renamed[0]) {
		t.Fatalf("folderSnapshot after mode write = %v, %v; want the renamed snapshot unchanged", same, ok)
	}
	// Removing the folder empties the snapshot again.
	if err := store.Remove(folder.ID); err != nil {
		t.Fatal(err)
	}
	snap, ok = folderSnapshot(cfg)
	if !ok || len(snap) != 0 {
		t.Fatalf("folderSnapshot after remove = %v, %v; want [], true", snap, ok)
	}
	// No store is unreadable, not empty.
	if _, ok := folderSnapshot(Config{}); ok {
		t.Fatal("folderSnapshot with no store must be unreadable")
	}
}

func TestWatchFolders(t *testing.T) {
	home := t.TempDir()
	store, err := config.Open(home)
	if err != nil {
		t.Fatal(err)
	}
	cfg := Config{Store: store, PollInterval: 5 * time.Millisecond}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		watchFolders(ctx, cancel, cfg)
	}()
	// No change yet: the session must stay alive.
	select {
	case <-ctx.Done():
		t.Fatal("watchFolders canceled with no folder change")
	case <-time.After(50 * time.Millisecond):
	}
	// A mode-cache write is not a folder change: still alive.
	if err := store.SetWriteApprovalMode("manual"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-ctx.Done():
		t.Fatal("watchFolders canceled on a mode-only config write")
	case <-time.After(50 * time.Millisecond):
	}
	// A folder added while connected ends the session, so Run reconnects
	// and re-hellos with the new claims.
	one := t.TempDir()
	if _, err := store.Allow(one, "one"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-ctx.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("watchFolders did not cancel after a folder was added")
	}
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("watchFolders did not return after canceling")
	}
}

type signedRequest struct {
	payload   json.RawMessage
	sig       string
	publicKey string
}

func readSigned(t *testing.T, r *http.Request) signedRequest {
	t.Helper()
	var body struct {
		Payload json.RawMessage `json:"payload"`
		Sig     string          `json:"sig"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		t.Fatalf("body: %v", err)
	}
	var payload struct {
		PublicKey string `json:"publicKey"`
	}
	_ = json.Unmarshal(body.Payload, &payload)
	return signedRequest{payload: body.Payload, sig: body.Sig, publicKey: payload.PublicKey}
}

func writeJSON(t *testing.T, w http.ResponseWriter, v any) {
	t.Helper()
	w.Header().Set("content-type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		t.Errorf("write: %v", err)
	}
}

type ioDiscard struct{}

func (ioDiscard) Write(p []byte) (int, error) { return len(p), nil }

func TestRunReportsState(t *testing.T) {
	browserOpen := browser.Open
	browser.Open = func(string) error { return nil }
	t.Cleanup(func() { browser.Open = browserOpen })
	home := t.TempDir()
	id, err := identity.LoadOrCreate(home)
	if err != nil {
		t.Fatal(err)
	}
	store, err := config.Open(home)
	if err != nil {
		t.Fatal(err)
	}
	stateDir := t.TempDir()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/pair/status":
			writeJSON(t, w, map[string]string{"state": "active"})
		case strings.HasSuffix(r.URL.Path, "/ws"):
			conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
			if err != nil {
				return
			}
			defer func() { _ = conn.Close(websocket.StatusNormalClosure, "") }()
			ctx := r.Context()
			_, data, err := conn.Read(ctx)
			if err != nil {
				return
			}
			msg, err := protocol.Parse(data)
			if err != nil || msg.Type != protocol.TypeHello {
				t.Errorf("hello: %v", err)
				return
			}
			ack, _ := json.Marshal(map[string]any{"ok": true, "heartbeatSec": 20, "approvedFolderIds": []string{}})
			reply := protocol.Message{V: 1, Type: protocol.TypeHelloAck, ID: msg.ID, Payload: ack}
			raw, _ := reply.Marshal()
			if err := conn.Write(ctx, websocket.MessageText, raw); err != nil {
				return
			}
			<-ctx.Done()
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	var mu sync.Mutex
	var states []State
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	done := make(chan struct{})
	go func() {
		_ = Run(ctx, Config{
			Server:       srv.URL,
			Web:          "http://localhost:5173",
			Name:         "test",
			Version:      "test",
			Identity:     id,
			Store:        store,
			PollInterval: 20 * time.Millisecond,
			Heartbeat:    time.Hour,
			IdleTimeout:  time.Hour,
			Backoff:      func(int) time.Duration { return 10 * time.Millisecond },
			Stdout:       ioDiscard{},
			StateDir:     stateDir,
			OnState: func(s State) {
				mu.Lock()
				states = append(states, s)
				mu.Unlock()
			},
		})
		close(done)
	}()

	// Wait for the Connected state (Connecting comes first).
	deadline := time.Now().Add(5 * time.Second)
	connected := false
	for time.Now().Before(deadline) {
		mu.Lock()
		for _, s := range states {
			if s == StateConnected {
				connected = true
			}
		}
		mu.Unlock()
		if connected {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !connected {
		mu.Lock()
		got := append([]State(nil), states...)
		mu.Unlock()
		t.Fatalf("never reached Connected, states = %v", got)
	}
	mu.Lock()
	if len(states) == 0 || states[0] != StateConnecting {
		t.Errorf("first state = %v, want Connecting", states)
	}
	mu.Unlock()

	// The connection time must be recorded for `folderlink doctor`.
	raw, err := os.ReadFile(filepath.Join(stateDir, LastConnectedName))
	if err != nil {
		t.Fatalf("last-connected file: %v", err)
	}
	if _, err := time.Parse(time.RFC3339, strings.TrimSpace(string(raw))); err != nil {
		t.Fatalf("last-connected %q is not RFC3339: %v", raw, err)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("bridge did not stop")
	}
}
