//go:build windows

package notify

import (
	"bytes"
	"testing"
)

func TestIconDecodes(t *testing.T) {
	if len(iconPNG) == 0 || !bytes.HasPrefix(iconPNG, []byte{0x89, 'P', 'N', 'G'}) {
		t.Fatalf("iconPNG did not decode to a .png file (%d bytes)", len(iconPNG))
	}
}

func TestDecodeIconBadInput(t *testing.T) {
	if got := decodeIcon("!!!not-base64!!!"); got != nil {
		t.Fatalf("decodeIcon(bad input) = %d bytes, want nil", len(got))
	}
}
