package tray

import (
	"testing"

	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/client"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/mode"
)

func TestStatusTitle(t *testing.T) {
	cases := []struct {
		state client.State
		want  string
	}{
		{client.StateConnecting, "◐ Connecting…"},
		{client.StateConnected, "● Connected"},
		{client.StateOffline, "○ Offline — retrying"},
	}
	for _, tc := range cases {
		if got := statusTitle(tc.state); got != tc.want {
			t.Errorf("statusTitle(%v) = %q, want %q", tc.state, got, tc.want)
		}
	}
}

func TestSetStateBeforeRun(t *testing.T) {
	// SetState must not panic before the menu exists, and the latest state
	// must be the one the menu shows when it is created.
	SetState(client.StateConnected)
	if got := currentState(); got != client.StateConnected {
		t.Fatalf("currentState() = %v, want Connected", got)
	}
	SetState(client.StateOffline)
	if got := currentState(); got != client.StateOffline {
		t.Fatalf("currentState() = %v, want Offline", got)
	}
	SetState(client.StateConnecting)
}

func TestSetNotifySuccessBeforeRun(t *testing.T) {
	// SetNotifySuccess must not panic before the menu exists, and the
	// latest value must be the one the checkbox shows when created.
	SetNotifySuccess(true)
	if !currentNotifySuccess() {
		t.Fatal("currentNotifySuccess() = false, want true")
	}
	SetNotifySuccess(false)
	if currentNotifySuccess() {
		t.Fatal("currentNotifySuccess() = true, want false")
	}
}

func TestModeTitle(t *testing.T) {
	if got := modeTitle(mode.ModeAI); got != "Write approval: AI approval" {
		t.Fatalf("modeTitle(ai) = %q", got)
	}
	if got := modeTitle(mode.ModeManual); got != "Write approval: Manual approval" {
		t.Fatalf("modeTitle(manual) = %q", got)
	}
}

func TestSetModeBeforeRun(t *testing.T) {
	// SetMode must not panic before the menu exists, and the latest mode
	// must be the one the menu shows when it is created.
	SetMode(mode.ModeAI)
	if got := currentModeValue(); got != mode.ModeAI {
		t.Fatalf("currentModeValue() = %v, want ai", got)
	}
	SetMode(mode.ModeManual)
	if got := currentModeValue(); got != mode.ModeManual {
		t.Fatalf("currentModeValue() = %v, want manual", got)
	}
}
