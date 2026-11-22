package protocol

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
)

const Version = 1

const (
	TypeHello    = "hello"
	TypeHelloAck = "hello_ack"
	TypePing     = "ping"
	TypePong     = "pong"
	TypeRequest  = "request"
	TypeResponse = "response"
	TypeError    = "error"
)

// Message is one websocket frame. Payload is signed only for hello.
type Message struct {
	V       int             `json:"v"`
	Type    string          `json:"type"`
	ID      string          `json:"id"`
	Payload json.RawMessage `json:"payload,omitempty"`
	Sig     string          `json:"sig,omitempty"`
}

func Parse(raw []byte) (Message, error) {
	if len(raw) == 0 || len(raw) > 1<<20 {
		return Message{}, fmt.Errorf("message has an invalid size")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var msg Message
	if err := dec.Decode(&msg); err != nil {
		return Message{}, fmt.Errorf("message is not valid JSON")
	}
	if msg.V != Version || msg.ID == "" || !knownType(msg.Type) {
		return Message{}, fmt.Errorf("message is not a supported envelope")
	}
	return msg, nil
}

func (m Message) Marshal() ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(m); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

func knownType(t string) bool {
	switch t {
	case TypeHello, TypeHelloAck, TypePing, TypePong, TypeRequest, TypeResponse, TypeError:
		return true
	default:
		return false
	}
}

// SignedBody is the HTTP body used by pairing calls.
type SignedBody struct {
	Payload json.RawMessage `json:"payload"`
	Sig     string          `json:"sig"`
}

// SignPayload canonicalizes payload and signs those exact bytes.
func SignPayload(priv ed25519.PrivateKey, payload any) (SignedBody, error) {
	canon, err := Canonical(payload)
	if err != nil {
		return SignedBody{}, err
	}
	sig := ed25519.Sign(priv, []byte(canon))
	raw, err := marshal(payload)
	if err != nil {
		return SignedBody{}, err
	}
	return SignedBody{Payload: raw, Sig: base64.RawURLEncoding.EncodeToString(sig)}, nil
}

func VerifyPayload(pub ed25519.PublicKey, payload json.RawMessage, sig string) error {
	sigBytes, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil {
		return fmt.Errorf("signature is not valid")
	}
	dec := json.NewDecoder(bytes.NewReader(payload))
	dec.UseNumber()
	var generic any
	if err := dec.Decode(&generic); err != nil {
		return fmt.Errorf("payload is not valid")
	}
	canon, err := Canonical(generic)
	if err != nil {
		return err
	}
	if !ed25519.Verify(pub, []byte(canon), sigBytes) {
		return fmt.Errorf("signature was rejected")
	}
	return nil
}

func bytesReader(b []byte) *bytes.Reader {
	return bytes.NewReader(b)
}
