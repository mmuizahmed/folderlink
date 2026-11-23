package protocol

import (
	"crypto/ed25519"
	"encoding/hex"
	"testing"
)

func TestSignatureVector(t *testing.T) {
	seed, err := hex.DecodeString("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
	if err != nil {
		t.Fatal(err)
	}
	priv := ed25519.NewKeyFromSeed(seed)
	payload := map[string]any{
		"deviceId": "22222222-2222-4222-8222-222222222222",
		"op":       "hello",
		"protocol": 1,
	}
	body, err := SignPayload(priv, payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyPayload(priv.Public().(ed25519.PublicKey), body.Payload, body.Sig); err != nil {
		t.Fatal(err)
	}
	const want = "oExH-zgwa4uEJmxOoIykHxALjG7v3PEnskT0Zx0-HqhQnKAN8PVbogw8u6vzFEnLEjQm0U1kLureOsrqCp8GBQ"
	if body.Sig != want {
		t.Fatalf("signature\n got %s\nwant %s", body.Sig, want)
	}
}
