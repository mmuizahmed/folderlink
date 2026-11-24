package mode

import "testing"

func TestParse(t *testing.T) {
	if m, ok := Parse("ai"); !ok || m != ModeAI {
		t.Fatalf("Parse(ai) = %v, %v", m, ok)
	}
	if m, ok := Parse("manual"); !ok || m != ModeManual {
		t.Fatalf("Parse(manual) = %v, %v", m, ok)
	}
	for _, bad := range []string{"", "AI", "auto", "none"} {
		if _, ok := Parse(bad); ok {
			t.Fatalf("Parse(%q) succeeded", bad)
		}
	}
}

func TestNewDefaultsToManual(t *testing.T) {
	// No cache and no sync: fail closed to manual.
	for _, cached := range []string{"", "bogus"} {
		store := New(cached)
		if store.Get() != ModeManual {
			t.Fatalf("New(%q).Get() = %v, want manual", cached, store.Get())
		}
		if store.Synced() {
			t.Fatalf("New(%q).Synced() = true", cached)
		}
	}
	if store := New("ai"); store.Get() != ModeAI {
		t.Fatalf("New(ai).Get() = %v", store.Get())
	}
}

func TestSetMarksSynced(t *testing.T) {
	store := New("")
	store.Set(ModeAI)
	if store.Get() != ModeAI || !store.Synced() {
		t.Fatalf("after Set(ai): Get() = %v, Synced() = %v", store.Get(), store.Synced())
	}
	store.Set(ModeManual)
	if store.Get() != ModeManual {
		t.Fatalf("after Set(manual): Get() = %v", store.Get())
	}
}

func TestLabel(t *testing.T) {
	if ModeAI.Label() != "AI approval" || ModeManual.Label() != "Manual approval" {
		t.Fatalf("labels: %q, %q", ModeAI.Label(), ModeManual.Label())
	}
}
