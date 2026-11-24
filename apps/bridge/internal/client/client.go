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
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/approve"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/browser"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/config"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/execrun"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/identity"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/mode"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/notify"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/pair"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/protocol"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/tools"
)

var (
	errRevoked  = errors.New("device revoked")
	errUnpaired = errors.New("device is not paired")
)

const pickerOperationTimeout = 10 * time.Minute

// State is the bridge's connection state, reported to Config.OnState when set.
type State int

const (
	// StateConnecting is the initial state and the state while pairing or redialling.
	StateConnecting State = iota
	// StateConnected means the websocket is open and the hello was accepted.
	StateConnected
	// StateOffline means the last connection dropped and the bridge is backing off.
	StateOffline
)

func (s State) String() string {
	switch s {
	case StateConnected:
		return "Connected"
	case StateOffline:
		return "Offline"
	default:
		return "Connecting"
	}
}

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
	// OnState is called on every connection-state change, if set. It is
	// how the system tray knows what to show. It must not block.
	OnState func(State)
	// StateDir is the config directory. When set, the time of the last
	// successful connection is recorded there for `folderlink doctor`.
	StateDir string
	// Notify sends a toast for refused reads (always) and successful reads
	// (opt-in). Nil disables notifications; console runs leave it nil.
	Notify *notify.Notifier
	// Approve holds pending dashboard approvals and minted tokens. Nil
	// disables the write/exec tools; Run creates one when unset.
	Approve *approve.Store
	// Exec tracks running commands for exec_poll. Nil disables run_command;
	// Run creates one when unset.
	Exec *execrun.Registry
	// Mode is the write approval mode the bridge enforces. Run creates
	// one from the local cache when unset; the worker re-syncs it on
	// hello and pushes changes live.
	Mode *mode.Store
	// OnMode is called when the mode changes (hello sync or a settings
	// push), if set. It must not block.
	OnMode func(mode.Mode)
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
		cfg.setState(StateConnecting)
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
		if err != nil {
			cfg.setState(StateOffline)
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

// LastConnectedName is the file in the config directory that records the
// last successful connection, for `folderlink doctor`.
const LastConnectedName = "last-connected"

func (cfg Config) setState(s State) {
	if cfg.OnState != nil {
		cfg.OnState(s)
	}
}

// recordConnected notes the current time in the config directory. It never
// fails the connection: a bridge that cannot write its own directory still
// works, it just has nothing for doctor to report.
func recordConnected(cfg Config) {
	if cfg.StateDir == "" {
		return
	}
	_ = os.WriteFile(filepath.Join(cfg.StateDir, LastConnectedName),
		[]byte(time.Now().UTC().Format(time.RFC3339)), 0o600)
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
	if cfg.Approve == nil {
		cfg.Approve = approve.New()
	}
	if cfg.Exec == nil {
		cfg.Exec = execrun.NewRegistry()
	}
	if cfg.Mode == nil {
		// Seed from the local cache. An empty cache means manual: fail
		// closed until the worker syncs the mode on hello.
		cached := ""
		if cfg.Store != nil {
			if file, err := cfg.Store.Load(); err == nil {
				cached = file.WriteApprovalMode
			}
		}
		cfg.Mode = mode.New(cached)
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
		link, linkErr := browser.PairPage(cfg.Web, begun.Code)
		if linkErr != nil {
			fmt.Fprintf(cfg.Stdout, "Pairing code: %s\n", begun.Code)
		} else {
			fmt.Fprintf(cfg.Stdout, "Opening %s to connect this computer.\n", link)
			if err := browser.Open(link); err != nil {
				fmt.Fprintln(cfg.Stdout, "If the browser did not open, paste that address yourself.")
			}
		}
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
	// A folder added while the bridge is connected (Explorer menu,
	// `folderlink allow`) only reaches the dashboard at the next hello.
	// Watch the local folder list and reconnect when it changes, so the
	// new folder appears in the dashboard with no manual restart.
	go watchFolders(sessCtx, cancel, cfg)

	errCh := make(chan error, 1)
	go func() {
		errCh <- sess.readLoop(sessCtx, activity, func(msg protocol.Message) {
			sess.handleRequest(sessCtx, cfg, msg)
		}, func(msg protocol.Message) {
			var payload struct {
				WriteApprovalMode string `json:"writeApprovalMode"`
			}
			if json.Unmarshal(msg.Payload, &payload) != nil {
				return
			}
			applyMode(cfg, payload.WriteApprovalMode)
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
	// The hello acknowledgement carries the write approval mode: apply
	// it before the first tool call can arrive.
	applyMode(cfg, ack.WriteApprovalMode)
	cfg.setState(StateConnected)
	recordConnected(cfg)
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

// folderSnapshot returns the bridge's current folder list as sorted
// identity strings (id, label, path), for change detection. The second
// result is false when the config cannot be read: a transient read
// failure must never look like an empty folder list.
func folderSnapshot(cfg Config) ([]string, bool) {
	if cfg.Store == nil {
		return nil, false
	}
	file, err := cfg.Store.Load()
	if err != nil {
		return nil, false
	}
	out := make([]string, 0, len(file.Folders))
	for _, folder := range file.Folders {
		out = append(out, folder.ID+"\x00"+folder.Label+"\x00"+folder.Path)
	}
	sort.Strings(out)
	return out, true
}

// watchFolders ends the current session when the local folder list
// changes, so Run reconnects and the next hello sends the new claims.
// It follows the watchIdle pattern: cancel the session context and let
// serveOnce return; Run's reconnect loop does the rest. The baseline is
// taken when the watcher starts (before hello), so a folder added
// between the baseline and hello can cause at most one harmless extra
// reconnect, and a folder added after hello triggers exactly one. Only
// the folder set matters: other config writes (the mode cache) must not
// trigger a reconnect, and a failed config read is retried next tick
// instead of reconnecting.
func watchFolders(ctx context.Context, cancel context.CancelFunc, cfg Config) {
	if cfg.Store == nil {
		return
	}
	interval := cfg.PollInterval
	if interval <= 0 {
		interval = 2 * time.Second
	}
	last, haveBaseline := folderSnapshot(cfg)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			now, ok := folderSnapshot(cfg)
			if !ok {
				continue
			}
			if !haveBaseline {
				last, haveBaseline = now, true
				continue
			}
			if !slices.Equal(last, now) {
				slog.Info("folder list changed; reconnecting to re-send folder claims")
				cancel()
				return
			}
			last = now
		}
	}
}

type helloAck struct {
	OK                bool     `json:"ok"`
	Reason            string   `json:"reason"`
	HeartbeatSec      int      `json:"heartbeatSec"`
	ApprovedFolderIDs []string `json:"approvedFolderIds"`
	// WriteApprovalMode is the user's write approval mode ("ai" or
	// "manual"), synced from the worker. Empty when the worker predates
	// the mode: applyMode ignores it and the current mode stands.
	WriteApprovalMode string `json:"writeApprovalMode"`
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

		var req struct {
			Op string `json:"op"`
		}
		opTimeout := cfg.OpTimeout
		if json.Unmarshal(msg.Payload, &req) == nil && req.Op == "pick_folder" {
			opTimeout = pickerOperationTimeout
		}
		opCtx, cancel := context.WithTimeout(ctx, opTimeout)
		defer cancel()
		result := tools.Dispatch(opCtx, cfg.Store, tools.Deps{
			Approve:      cfg.Approve,
			Exec:         cfg.Exec,
			Mode:         cfg.Mode,
			DashboardURL: cfg.Web,
		}, msg.Payload)
		notifyResult(cfg, msg.Payload, result)
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

// notifyResult tells the user about a read or a write, through the
// notifier. Only read and write operations notify: a refusal is always
// shown (an app asking for a secret is the event to see), a successful
// read only when the user opted in, a successful write or a started
// command always (a file changing is the event to see), and an
// approval_required result always (the user has to act on it). Anything
// else — a missing file, a bad request, a timeout — is not a refusal and
// stays quiet.
func notifyResult(cfg Config, raw json.RawMessage, result any) {
	if cfg.Notify == nil {
		return
	}
	var req notifyRequest
	if json.Unmarshal(raw, &req) != nil {
		return
	}
	switch req.Op {
	case "list_files", "read_file", "search_files", "read_media", "file_info":
		notifyReadResult(cfg, req, result)
	case "write_file", "delete_file", "run_command":
		notifyWriteResult(cfg, req, result)
	}
}

// notifyRequest is the part of a tool request the notifier needs.
type notifyRequest struct {
	Op       string   `json:"op"`
	FolderID string   `json:"folderId"`
	Path     string   `json:"path"`
	Command  string   `json:"command"`
	Args     []string `json:"args"`
}

func notifyReadResult(cfg Config, req notifyRequest, result any) {
	out, ok := resultEnvelope(result)
	if !ok {
		return
	}
	label := folderLabel(cfg, req.FolderID)
	if out.OK {
		cfg.Notify.Success(label, req.Path)
		return
	}
	switch out.Error.Code {
	case "denied", "outside_root", "binary":
		cfg.Notify.Refused(label, req.Path)
	}
}

func notifyWriteResult(cfg Config, req notifyRequest, result any) {
	out, ok := resultEnvelope(result)
	if !ok {
		return
	}
	label := folderLabel(cfg, req.FolderID)
	if out.OK {
		switch out.Result.Status {
		case "approval_required":
			cfg.Notify.ApprovalNeeded(label, req.Path, out.Result.RequestID)
		case "started":
			cfg.Notify.CommandStarted(label, append([]string{req.Command}, req.Args...))
		default:
			// A write or delete that executed: always shown.
			cfg.Notify.WriteDone(label, req.Path)
		}
		return
	}
	switch out.Error.Code {
	case "denied", "outside_root", "binary", "hash_mismatch":
		cfg.Notify.WriteRefused(label, req.Path)
	}
}

// resultEnvelope decodes the ok/error/status shape Dispatch returns.
func resultEnvelope(result any) (struct {
	OK    bool `json:"ok"`
	Error struct {
		Code string `json:"code"`
	} `json:"error"`
	Result struct {
		Status    string `json:"status"`
		RequestID string `json:"requestId"`
	} `json:"result"`
}, bool) {
	var out struct {
		OK    bool `json:"ok"`
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
		Result struct {
			Status    string `json:"status"`
			RequestID string `json:"requestId"`
		} `json:"result"`
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return out, false
	}
	if json.Unmarshal(encoded, &out) != nil {
		return out, false
	}
	return out, true
}

func folderLabel(cfg Config, folderID string) string {
	label := folderID
	if cfg.Store != nil {
		if file, err := cfg.Store.Load(); err == nil {
			for _, folder := range file.Folders {
				if folder.ID == folderID {
					label = folder.Label
					break
				}
			}
		}
	}
	return label
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

func (s *session) readLoop(ctx context.Context, activity chan<- struct{}, onRequest func(protocol.Message), onSettings func(protocol.Message)) error {
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
		case protocol.TypeSettings:
			if onSettings != nil {
				onSettings(msg)
			}
		default:
			s.deliver(msg)
		}
	}
}

// applyMode applies a write approval mode from the worker (hello_ack or
// a settings push): it updates the in-memory mode, caches it in the
// local config, and notifies the tray. An unknown or empty mode is
// ignored: the current mode stands, so a bad payload can never silently
// loosen the gate.
func applyMode(cfg Config, modeStr string) {
	m, ok := mode.Parse(modeStr)
	if !ok || cfg.Mode == nil {
		return
	}
	cfg.Mode.Set(m)
	if cfg.Store != nil {
		_ = cfg.Store.SetWriteApprovalMode(string(m))
	}
	if cfg.OnMode != nil {
		cfg.OnMode(m)
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
