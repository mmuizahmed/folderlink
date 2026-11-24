package approve

import (
	"testing"
	"time"
)

func TestApproveVerifyConsumes(t *testing.T) {
	store := New()
	p := store.Create(&Pending{
		Op:          OpWriteFile,
		FolderID:    "f1",
		FolderLabel: "notes",
		Path:        "a.md",
		ContentHash: "content-hash",
		PreHash:     "pre-hash",
	})
	if p.ID == "" {
		t.Fatal("created request has no id")
	}
	binding := Binding{
		Op:          OpWriteFile,
		FolderID:    "f1",
		Path:        "a.md",
		ContentHash: "content-hash",
		PreHash:     "pre-hash",
	}
	// No token yet: the request is still pending.
	if ok, reason := store.Verify(p.ID, binding); ok || reason != "no_token" {
		t.Fatalf("Verify before approval = %v, %q", ok, reason)
	}
	if got := store.Get(p.ID); got == nil {
		t.Fatal("pending request disappeared before approval")
	}
	if !store.Approve(p.ID) {
		t.Fatal("Approve failed")
	}
	if got := store.Get(p.ID); got != nil {
		t.Fatal("approved request is still pending")
	}
	if ok, reason := store.Verify(p.ID, binding); !ok {
		t.Fatalf("Verify after approval = %v, %q", ok, reason)
	}
	// Single-use: the second verification finds no token.
	if ok, reason := store.Verify(p.ID, binding); ok || reason != "no_token" {
		t.Fatalf("second Verify = %v, %q", ok, reason)
	}
}

func TestVerifyBindingMismatchBurnsToken(t *testing.T) {
	store := New()
	p := store.Create(&Pending{
		Op:          OpWriteFile,
		FolderID:    "f1",
		Path:        "a.md",
		ContentHash: "content-hash",
		PreHash:     "pre-hash",
	})
	if !store.Approve(p.ID) {
		t.Fatal("Approve failed")
	}
	// The content changed between approval and the second call.
	ok, reason := store.Verify(p.ID, Binding{
		Op:          OpWriteFile,
		FolderID:    "f1",
		Path:        "a.md",
		ContentHash: "tampered",
		PreHash:     "pre-hash",
	})
	if ok || reason != "hash_mismatch" {
		t.Fatalf("Verify with tampered content = %v, %q", ok, reason)
	}
	// The failed attempt burned the token: even the right binding fails.
	ok, _ = store.Verify(p.ID, Binding{
		Op:          OpWriteFile,
		FolderID:    "f1",
		Path:        "a.md",
		ContentHash: "content-hash",
		PreHash:     "pre-hash",
	})
	if ok {
		t.Fatal("Verify succeeded after the token was burned")
	}
}

func TestDenyAndUnknown(t *testing.T) {
	store := New()
	p := store.Create(&Pending{Op: OpDeleteFile, FolderID: "f1", Path: "old.txt"})
	if !store.Deny(p.ID) {
		t.Fatal("Deny failed")
	}
	if ok, _ := store.Verify(p.ID, Binding{Op: OpDeleteFile, FolderID: "f1", Path: "old.txt"}); ok {
		t.Fatal("Verify succeeded for a denied request")
	}
	if store.Approve(p.ID) {
		t.Fatal("Approve succeeded for a denied request")
	}
	if store.Approve("00000000-0000-0000-0000-000000000000") {
		t.Fatal("Approve succeeded for an unknown request")
	}
	if store.Deny("00000000-0000-0000-0000-000000000000") {
		t.Fatal("Deny succeeded for an unknown request")
	}
}

func TestPendingExpiry(t *testing.T) {
	old := PendingRequestLifetime
	PendingRequestLifetime = time.Millisecond
	defer func() { PendingRequestLifetime = old }()
	store := New()
	p := store.Create(&Pending{Op: OpDeleteFile, FolderID: "f1", Path: "old.txt"})
	time.Sleep(5 * time.Millisecond)
	if got := store.Get(p.ID); got != nil {
		t.Fatal("expired pending request is still listed")
	}
	if store.Approve(p.ID) {
		t.Fatal("Approve succeeded for an expired request")
	}
}

func TestTokenExpiry(t *testing.T) {
	old := TokenLifetime
	TokenLifetime = time.Millisecond
	defer func() { TokenLifetime = old }()
	store := New()
	p := store.Create(&Pending{
		Op:          OpWriteFile,
		FolderID:    "f1",
		Path:        "a.md",
		ContentHash: "c",
		PreHash:     "p",
	})
	if !store.Approve(p.ID) {
		t.Fatal("Approve failed")
	}
	time.Sleep(5 * time.Millisecond)
	ok, reason := store.Verify(p.ID, Binding{
		Op: OpWriteFile, FolderID: "f1", Path: "a.md", ContentHash: "c", PreHash: "p",
	})
	if ok || reason != "approval_expired" {
		t.Fatalf("Verify after token expiry = %v, %q", ok, reason)
	}
}
