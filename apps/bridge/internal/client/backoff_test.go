package client

import (
	"testing"
	"time"
)

func TestBackoffBounds(t *testing.T) {
	low := Backoff(0, 0)
	high := Backoff(0, 1)
	if low != 800*time.Millisecond || high != 1200*time.Millisecond {
		t.Fatalf("first delay %s %s", low, high)
	}
	if Backoff(20, 0) != 24*time.Second {
		t.Fatalf("cap low = %s", Backoff(20, 0))
	}
	if Backoff(20, 1) != 36*time.Second {
		t.Fatalf("cap high = %s", Backoff(20, 1))
	}
}

func TestValidateServer(t *testing.T) {
	if err := ValidateServer("http://127.0.0.1:8787"); err != nil {
		t.Fatal(err)
	}
	if err := ValidateServer("https://mcp.muiz.pk"); err != nil {
		t.Fatal(err)
	}
	if err := ValidateServer("http://mcp.muiz.pk"); err == nil {
		t.Fatal("cleartext public server was accepted")
	}
	if err := ValidateServer("https://user:pass@mcp.muiz.pk"); err == nil {
		t.Fatal("credentials were accepted")
	}
}
