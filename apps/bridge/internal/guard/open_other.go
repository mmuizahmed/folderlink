//go:build !linux

package guard

import "os"

func verifyFD(root string, f *os.File) error {
	if root == "" || f == nil {
		return code("invalid_path", "The path could not be verified.")
	}
	if _, err := f.Stat(); err != nil {
		return code("invalid_path", "The path could not be verified.")
	}
	return nil
}
