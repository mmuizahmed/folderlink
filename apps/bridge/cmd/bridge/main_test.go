package main

import (
	"reflect"
	"testing"
)

func TestSplitCommand(t *testing.T) {
	if cmd, _ := splitCommand(nil); cmd != "run" {
		t.Fatalf("no arguments should start the app, got %s", cmd)
	}
	if cmd, rest := splitCommand([]string{"start"}); cmd != "start" || len(rest) != 0 {
		t.Fatalf("splitCommand([start]) = %q %#v, want start []", cmd, rest)
	}
	if cmd, _ := splitCommand([]string{"--server", "http://127.0.0.1:8787", "start"}); cmd != "start" {
		t.Fatalf("splitCommand with flags before start = %q, want start", cmd)
	}
	cmd, rest := splitCommand([]string{"--server", "http://127.0.0.1:8787", "allow", "/tmp/notes", "--label", "notes"})
	if cmd != "allow" {
		t.Fatal(cmd)
	}
	ordered := orderFlagsFirst(rest)
	if !reflect.DeepEqual(ordered, []string{"--server", "http://127.0.0.1:8787", "--label", "notes", "/tmp/notes"}) {
		t.Fatalf("%#v", ordered)
	}
	cmd, rest = splitCommand([]string{"allow", "/tmp/notes", "--label", "notes"})
	if cmd != "allow" || !reflect.DeepEqual(orderFlagsFirst(rest), []string{"--label", "notes", "/tmp/notes"}) {
		t.Fatalf("%s %#v", cmd, orderFlagsFirst(rest))
	}
}
