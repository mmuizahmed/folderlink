// Package pair registers this device with the worker and waits until a person enters the code.
package pair

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"runtime"
	"time"

	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/identity"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/protocol"
)

// HTTPError is a non-2xx response from the worker.
type HTTPError struct {
	Status  int
	Message string
}

func (e *HTTPError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("%d %s", e.Status, e.Message)
	}
	return fmt.Sprintf("%d pairing request failed", e.Status)
}

// Client calls the worker's pairing endpoints.
type Client struct {
	BaseURL string
	HTTP    *http.Client
}

// BeginResult is a short code the person types into the control panel.
type BeginResult struct {
	Code      string
	ExpiresAt time.Time
}

// Status is the device record the worker currently has.
type Status struct {
	State string
}

type beginResponse struct {
	Code      string `json:"code"`
	ExpiresAt string `json:"expiresAt"`
}

type statusResponse struct {
	State string `json:"state"`
}

// Begin asks for a new pairing code. The request is signed by the device key.
func (c Client) Begin(ctx context.Context, id *identity.Identity, name string) (BeginResult, error) {
	nonce, err := identity.NewNonce()
	if err != nil {
		return BeginResult{}, err
	}
	body, err := id.Sign(map[string]any{
		"op":        "pair_begin",
		"protocol":  protocol.Version,
		"deviceId":  id.DeviceID,
		"publicKey": id.PublicB64(),
		"name":      name,
		"os":        runtime.GOOS,
		"arch":      runtime.GOARCH,
		"ts":        time.Now().Unix(),
		"nonce":     nonce,
	})
	if err != nil {
		return BeginResult{}, err
	}
	var out beginResponse
	if err := c.post(ctx, "/api/pair/begin", body, &out); err != nil {
		return BeginResult{}, err
	}
	expires, err := time.Parse(time.RFC3339, out.ExpiresAt)
	if err != nil || out.Code == "" {
		return BeginResult{}, fmt.Errorf("pairing response was incomplete")
	}
	return BeginResult{Code: out.Code, ExpiresAt: expires}, nil
}

// Status reports whether this device is paired. An unknown device has state "absent".
func (c Client) Status(ctx context.Context, id *identity.Identity) (Status, error) {
	nonce, err := identity.NewNonce()
	if err != nil {
		return Status{}, err
	}
	body, err := id.Sign(map[string]any{
		"op":       "pair_status",
		"protocol": protocol.Version,
		"deviceId": id.DeviceID,
		"ts":       time.Now().Unix(),
		"nonce":    nonce,
	})
	if err != nil {
		return Status{}, err
	}
	var out statusResponse
	err = c.post(ctx, "/api/pair/status", body, &out)
	if err != nil {
		var httpErr *HTTPError
		if errors.As(err, &httpErr) && httpErr.Status == http.StatusNotFound {
			return Status{State: "absent"}, nil
		}
		return Status{}, err
	}
	if out.State == "" {
		return Status{}, fmt.Errorf("pairing status was incomplete")
	}
	return Status{State: out.State}, nil
}

func (c Client) post(ctx context.Context, path string, body protocol.SignedBody, dest any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	endpoint, err := url.JoinPath(c.BaseURL, path)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("accept", "application/json")
	req.Header.Set("user-agent", "FolderLink/0.1.0")
	client := c.HTTP
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = res.Body.Close() }()
	payload, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var api struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(payload, &api)
		return &HTTPError{Status: res.StatusCode, Message: api.Error.Message}
	}
	if dest == nil {
		return nil
	}
	if err := json.Unmarshal(payload, dest); err != nil {
		return fmt.Errorf("pairing response was not valid")
	}
	return nil
}
