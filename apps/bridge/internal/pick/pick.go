// Package pick asks the operating system for a directory.
package pick

// Open is the folder dialog. Tests replace it.
var Open = openNative

// Cancelled means the person closed the dialog.
var ErrCancelled = errCancelled{}

type errCancelled struct{}

func (errCancelled) Error() string { return "folder selection was cancelled" }
