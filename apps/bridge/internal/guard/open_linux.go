//go:build linux

package guard

import (
	"fmt"
	"os"
	"strings"
)

func verifyFD(root string, f *os.File) error {
	link, err := os.Readlink(fmt.Sprintf("/proc/self/fd/%d", f.Fd()))
	if err != nil {
		return code("invalid_path", "The path could not be verified.")
	}
	link = strings.TrimSuffix(link, " (deleted)")
	if !Within(root, link) {
		return code("outside_root", "The path is outside the allowed folder.")
	}
	return nil
}
