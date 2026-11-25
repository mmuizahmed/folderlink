// Package identity stores the device key that authenticates the bridge.
package identity

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/mmuizahmed/folderlink/apps/bridge/internal/protocol"
)

// Identity is the long-lived device keypair.
type Identity struct {
	DeviceID string
	Public   ed25519.PublicKey
	Private  ed25519.PrivateKey
}

type file struct {
	DeviceID string `json:"deviceId"`
	Seed     string `json:"seed"`
}

// LoadOrCreate reads the key from dir/identity.json, or creates one.
func LoadOrCreate(dir string) (*Identity, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "identity.json")
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return create(path)
	}
	if err != nil {
		return nil, err
	}
	var stored file
	if err := json.Unmarshal(raw, &stored); err != nil {
		return nil, fmt.Errorf("identity file is not valid")
	}
	seed, err := base64.RawURLEncoding.DecodeString(stored.Seed)
	if err != nil || len(seed) != ed25519.SeedSize || stored.DeviceID == "" {
		return nil, fmt.Errorf("identity file is not valid")
	}
	priv := ed25519.NewKeyFromSeed(seed)
	return &Identity{DeviceID: stored.DeviceID, Public: priv.Public().(ed25519.PublicKey), Private: priv}, nil
}

func create(path string) (*Identity, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	id, err := NewID()
	if err != nil {
		return nil, err
	}
	body, err := json.MarshalIndent(file{
		DeviceID: id,
		Seed:     base64.RawURLEncoding.EncodeToString(priv.Seed()),
	}, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := writePrivate(path, body); err != nil {
		return nil, err
	}
	return &Identity{DeviceID: id, Public: pub, Private: priv}, nil
}

func writePrivate(path string, body []byte) error {
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(append(body, '\n')); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// PublicB64 is the raw public key, without padding.
func (id *Identity) PublicB64() string {
	return base64.RawURLEncoding.EncodeToString(id.Public)
}

// Sign canonicalizes payload and signs it.
func (id *Identity) Sign(payload any) (protocol.SignedBody, error) {
	return protocol.SignPayload(id.Private, payload)
}

// NewID returns a random UUID version 4.
func NewID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}

// NewNonce returns 16 random bytes, encoded without padding.
func NewNonce() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}
