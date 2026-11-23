// Package pick asks the operating system for a directory.
package pick

// Open is the folder dialog. Tests replace it.
var Open = openNative

// Canceled means the person closed the dialog.
var ErrCanceled = errCanceled{}

type errCanceled struct{}

func (errCanceled) Error() string { return "folder selection was canceled" }
