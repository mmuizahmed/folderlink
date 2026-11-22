package client

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/config"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/identity"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/protocol"
)

func TestRunAnswersReadAndRejectsEscape(t *testing.T) {
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
