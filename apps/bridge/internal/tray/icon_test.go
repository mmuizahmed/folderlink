//go:build windows

package tray

import (
	"bytes"
	"testing"
)

func TestIconsDecode(t *testing.T) {
	if len(iconICO) == 0 || !bytes.HasPrefix(iconICO, []byte{0x00, 0x00, 0x01, 0x00}) {
		t.Fatalf("iconICO did not decode to an .ico file (%d bytes)", len(iconICO))
	}
	if len(iconPNG) == 0 || !bytes.HasPrefix(iconPNG, []byte{0x89, 'P', 'N', 'G'}) {
		t.Fatalf("iconPNG did not decode to a .png file (%d bytes)", len(iconPNG))
	}
}

func TestDecodeIconBadInput(t *testing.T) {
	if got := decodeIcon("!!!not-base64!!!"); got != nil {
		t.Fatalf("decodeIcon(bad input) = %d bytes, want nil", len(got))
	}
}
