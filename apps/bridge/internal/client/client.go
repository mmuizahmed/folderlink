// Package client keeps an outbound websocket open and answers tool requests.
package client

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/config"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/identity"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/pair"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/protocol"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/tools"
)

var (
	errRevoked  = errors.New("device revoked")
	errUnpaired = errors.New("device is not paired")
)

// Config controls one running bridge.
type Config struct {
	Server       string
	Web          string
	Name         string
	Version      string
	Identity     *identity.Identity
	Store        *config.Store
	Pair         pair.Client
	Stdout       io.Writer
	PollInterval time.Duration
	Heartbeat    time.Duration
	IdleTimeout  time.Duration
	HelloTimeout time.Duration
	OpTimeout    time.Duration
	Backoff      func(attempt int) time.Duration
}

// Run pairs the device if needed and reconnects until ctx is canceled.
func Run(ctx context.Context, cfg Config) error {
	cfg = cfg.withDefaults()
	if err := ValidateServer(cfg.Server); err != nil {
		return err
	}
	attempt := 0
	for {
		if ctx.Err() != nil {
			return nil
		}
		err := ensurePaired(ctx, cfg)
		if ctx.Err() != nil {
			return nil
		}
		if err != nil {
			slog.Warn("pairing", "err", err.Error())
			if !sleep(ctx, cfg.Backoff(attempt)) {
				return nil
			}
			attempt++
			continue
		}
		started := time.Now()
		err = serveOnce(ctx, cfg)
		if ctx.Err() != nil {
			return nil
		}
		if err != nil && !errors.Is(err, errRevoked) && !errors.Is(err, errUnpaired) {
			slog.Info("connection closed", "err", err.Error())
		}
		if time.Since(started) > 30*time.Second {
			attempt = 0
		}
		if !sleep(ctx, cfg.Backoff(attempt)) {
			return nil
		}
		attempt++
	}
}

func (cfg Config) withDefaults() Config {
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = 2 * time.Second
	}
	if cfg.Heartbeat <= 0 {
		cfg.Heartbeat = 20 * time.Second
	}
	if cfg.IdleTimeout <= 0 {
		cfg.IdleTimeout = 45 * time.Second
	}
	if cfg.HelloTimeout <= 0 {
		cfg.HelloTimeout = 10 * time.Second
	}
	if cfg.OpTimeout <= 0 {
		cfg.OpTimeout = 12 * time.Second
	}
	if cfg.Backoff == nil {
		cfg.Backoff = DefaultBackoff
	}
	if cfg.Version == "" {
		cfg.Version = "dev"
	}
	if cfg.Pair.BaseURL == "" {
		cfg.Pair.BaseURL = cfg.Server
	}
	if cfg.Stdout == nil {
		cfg.Stdout = os.Stdout
	}
	if cfg.Name == "" {
		cfg.Name = config.DefaultName
	}
	return cfg
}

// ValidateServer rejects cleartext servers that are not on this machine.
func ValidateServer(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return fmt.Errorf("server URL is not valid")
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return fmt.Errorf("server URL must be http or https")
	}
	if u.User != nil {
		return fmt.Errorf("server URL must not include credentials")
	}
	host := strings.ToLower(u.Hostname())
	local := host == "localhost" || host == "127.0.0.1" || host == "::1"
	if u.Scheme == "http" && !local {
		return fmt.Errorf("refusing a non-local http server")
	}
	return nil
}

// WebSocketURL is the device socket for a server base URL.
func WebSocketURL(server, deviceID string) (string, error) {
	u, err := url.Parse(server)
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	case "http":
		u.Scheme = "ws"
	default:
		return "", fmt.Errorf("unsupported server URL")
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/device/" + deviceID + "/ws"
	u.RawQuery = ""
	u.Fragment = ""
	return u.String(), nil
}

func ensurePaired(ctx context.Context, cfg Config) error {
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		st, err := cfg.Pair.Status(ctx, cfg.Identity)
		if err != nil {
			return err
		}
		if st.State == "active" {
			return nil
		}
		if st.State == "revoked" {
			fmt.Fprintln(cfg.Stdout, "This device was revoked. A new pairing code follows.")
		}
		begun, err := cfg.Pair.Begin(ctx, cfg.Identity, cfg.Name)
		if err != nil {
			return err
		}
		fmt.Fprintf(cfg.Stdout, "Pairing code: %s\n", begun.Code)
		fmt.Fprintf(cfg.Stdout, "Open %s/connect and enter the code.\n", strings.TrimRight(cfg.Web, "/"))
		active, err := waitActive(ctx, cfg, begun.ExpiresAt.Add(-5*time.Second))
		if err != nil {
			return err
		}
		if active {
			fmt.Fprintln(cfg.Stdout, "Paired.")
			return nil
		}
	}
}

func waitActive(ctx context.Context, cfg Config, deadline time.Time) (bool, error) {
	ticker := time.NewTicker(cfg.PollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case <-ticker.C:
			st, err := cfg.Pair.Status(ctx, cfg.Identity)
			if err != nil {
				return false, err
			}
			if st.State == "active" {
				return true, nil
			}
			if !deadline.IsZero() && time.Now().After(deadline) {
				return false, nil
			}
		}
	}
}

func userAgent(version string) string {
	if version == "" {
		return "FolderLink"
	}
	return "FolderLink/" + version
}

func serveOnce(ctx context.Context, cfg Config) error {
	wsURL, err := WebSocketURL(cfg.Server, cfg.Identity.DeviceID)
	if err != nil {
		return err
	}
	dialCtx, cancelDial := context.WithTimeout(ctx, 15*time.Second)
	header := make(http.Header)
	header.Set("User-Agent", userAgent(cfg.Version))
	conn, _, err := websocket.Dial(dialCtx, wsURL, &websocket.DialOptions{HTTPHeader: header})
	cancelDial()
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close(websocket.StatusNormalClosure, "bye") }()
	conn.SetReadLimit(1 << 20)

	sess := newSession(conn)
	sessCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	activity := make(chan struct{}, 1)
	go watchIdle(sessCtx, cancel, cfg.IdleTimeout, activity)

	errCh := make(chan error, 1)
	go func() {
		errCh <- sess.readLoop(sessCtx, activity, func(msg protocol.Message) {
			sess.handleRequest(sessCtx, cfg, msg)
		})
	}()

	helloCtx, cancelHello := context.WithTimeout(sessCtx, cfg.HelloTimeout)
	ack, err := sess.hello(helloCtx, cfg)
	cancelHello()
	if err != nil {
		return err
	}
	if !ack.OK {
		if ack.Reason == "revoked" {
			return errRevoked
		}
		return errUnpaired
	}
	fmt.Fprintln(cfg.Stdout, "Connected.")
	go sess.ping(sessCtx, cfg.Heartbeat)

	select {
	case <-ctx.Done():
		return nil
	case err := <-errCh:
		if ctx.Err() != nil {
			return nil
		}
		return err
	}
}

func sleep(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func watchIdle(ctx context.Context, cancel context.CancelFunc, idle time.Duration, activity <-chan struct{}) {
	timer := time.NewTimer(idle)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-activity:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(idle)
		case <-timer.C:
			cancel()
			return
		}
	}
}

type helloAck struct {
	OK                bool     `json:"ok"`
	Reason            string   `json:"reason"`
	HeartbeatSec      int      `json:"heartbeatSec"`
	ApprovedFolderIDs []string `json:"approvedFolderIds"`
}

type folderClaim struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type session struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
	mu      sync.Mutex
	pending map[string]chan protocol.Message
	sem     chan struct{}
}

func newSession(conn *websocket.Conn) *session {
	return &session{
		conn:    conn,
		pending: map[string]chan protocol.Message{},
		sem:     make(chan struct{}, 4),
	}
}

func (s *session) hello(ctx context.Context, cfg Config) (helloAck, error) {
	file, err := cfg.Store.Load()
	if err != nil {
		return helloAck{}, err
	}
	claims := make([]folderClaim, 0, len(file.Folders))
	for _, folder := range file.Folders {
		claims = append(claims, folderClaim{ID: folder.ID, Label: folder.Label})
	}
	sort.Slice(claims, func(i, j int) bool { return claims[i].ID < claims[j].ID })
	nonce, err := identity.NewNonce()
	if err != nil {
		return helloAck{}, err
	}
	signed, err := cfg.Identity.Sign(map[string]any{
		"op":        "hello",
		"protocol":  protocol.Version,
		"deviceId":  cfg.Identity.DeviceID,
		"publicKey": cfg.Identity.PublicB64(),
		"name":      cfg.Name,
		"version":   cfg.Version,
		"ts":        time.Now().Unix(),
		"nonce":     nonce,
		"folders":   claims,
	})
	if err != nil {
		return helloAck{}, err
	}
	id, err := identity.NewID()
	if err != nil {
		return helloAck{}, err
	}
	ch := s.register(id)
	defer s.forget(id)
	if err := s.write(ctx, protocol.Message{
		V:       protocol.Version,
		Type:    protocol.TypeHello,
		ID:      id,
		Payload: signed.Payload,
		Sig:     signed.Sig,
	}); err != nil {
		return helloAck{}, err
	}
	select {
	case <-ctx.Done():
		return helloAck{}, ctx.Err()
	case msg, ok := <-ch:
		if !ok {
			return helloAck{}, fmt.Errorf("connection closed during hello")
		}
		var ack helloAck
		if err := json.Unmarshal(msg.Payload, &ack); err != nil {
			return helloAck{}, fmt.Errorf("hello acknowledgement was not valid")
		}
		return ack, nil
	}
}

func (s *session) handleRequest(ctx context.Context, cfg Config, msg protocol.Message) {
	select {
	case s.sem <- struct{}{}:
	default:
		_ = s.write(ctx, failureMessage(msg.ID, "unavailable", "The bridge is busy."))
		return
	}
	go func() {
		defer func() { <-s.sem }()
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("tool panic")
				_ = s.write(ctx, failureMessage(msg.ID, "internal", "The request could not be completed."))
			}
		}()
		opCtx, cancel := context.WithTimeout(ctx, cfg.OpTimeout)
		defer cancel()
		result := tools.Dispatch(opCtx, cfg.Store, msg.Payload)
		raw, err := json.Marshal(result)
		if err != nil {
			_ = s.write(ctx, failureMessage(msg.ID, "internal", "The request could not be completed."))
			return
		}
		_ = s.write(ctx, protocol.Message{
			V:       protocol.Version,
			Type:    protocol.TypeResponse,
			ID:      msg.ID,
			Payload: raw,
		})
	}()
}

func failureMessage(id, codeName, message string) protocol.Message {
	raw, _ := json.Marshal(map[string]any{
		"ok": false,
		"error": map[string]string{
			"code":    codeName,
			"message": message,
		},
	})
	return protocol.Message{V: protocol.Version, Type: protocol.TypeResponse, ID: id, Payload: raw}
}

func (s *session) ping(ctx context.Context, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			id, err := identity.NewID()
			if err != nil {
				return
			}
			raw, err := json.Marshal(map[string]any{"ts": time.Now().Unix()})
			if err != nil {
				return
			}
			if err := s.write(ctx, protocol.Message{
				V:       protocol.Version,
				Type:    protocol.TypePing,
				ID:      id,
				Payload: raw,
			}); err != nil {
				return
			}
		}
	}
}

func (s *session) readLoop(ctx context.Context, activity chan<- struct{}, onRequest func(protocol.Message)) error {
	for {
		_, data, err := s.conn.Read(ctx)
		if err != nil {
			return err
		}
		select {
		case activity <- struct{}{}:
		default:
		}
		msg, err := protocol.Parse(data)
		if err != nil {
			continue
		}
		switch msg.Type {
		case protocol.TypePing:
			_ = s.write(ctx, protocol.Message{V: protocol.Version, Type: protocol.TypePong, ID: msg.ID, Payload: msg.Payload})
		case protocol.TypeRequest:
			onRequest(msg)
		default:
			s.deliver(msg)
		}
	}
}

func (s *session) write(ctx context.Context, msg protocol.Message) error {
	raw, err := msg.Marshal()
	if err != nil {
		return err
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return s.conn.Write(ctx, websocket.MessageText, raw)
}

func (s *session) register(id string) chan protocol.Message {
	ch := make(chan protocol.Message, 1)
	s.mu.Lock()
	s.pending[id] = ch
	s.mu.Unlock()
	return ch
}

func (s *session) forget(id string) {
	s.mu.Lock()
	delete(s.pending, id)
	s.mu.Unlock()
}

func (s *session) deliver(msg protocol.Message) {
	s.mu.Lock()
	ch := s.pending[msg.ID]
	if ch != nil {
		delete(s.pending, msg.ID)
	}
	s.mu.Unlock()
	if ch == nil {
		return
	}
	select {
	case ch <- msg:
	default:
	}
}
