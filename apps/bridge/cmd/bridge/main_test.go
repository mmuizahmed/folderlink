package main

import (
	"reflect"
	"testing"
)

func TestSplitCommand(t *testing.T) {
	if cmd, _ := splitCommand(nil); cmd != "run" {
		t.Fatalf("no arguments should start the app, got %s", cmd)
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
