package protocol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestCanonicalVectors(t *testing.T) {
	path := filepath.Join("..", "..", "..", "..", "packages", "shared", "testdata", "canonical.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var vectors []struct {
		Name      string          `json:"name"`
		Value     json.RawMessage `json:"value"`
		Canonical string          `json:"canonical"`
	}
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatal(err)
	}
	if len(vectors) == 0 {
		t.Fatal("no vectors")
	}
	for _, vector := range vectors {
		t.Run(vector.Name, func(t *testing.T) {
			dec := json.NewDecoder(bytesReader(vector.Value))
			dec.UseNumber()
			var value any
			if err := dec.Decode(&value); err != nil {
				t.Fatal(err)
			}
			got, err := Canonical(value)
			if err != nil {
				t.Fatal(err)
			}
			if got != vector.Canonical {
				t.Fatalf("got %s want %s", got, vector.Canonical)
			}
		})
	}
}

func TestCanonicalRejectsFraction(t *testing.T) {
	if _, err := Canonical(map[string]any{"n": 1.5}); err == nil {
		t.Fatal("expected an error")
	}
}
