package client

import (
	"crypto/rand"
	"encoding/binary"
	"time"
)

// DefaultBackoff is the delay before reconnect attempt n, with 20% jitter.
func DefaultBackoff(attempt int) time.Duration {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return time.Second
	}
	unit := float64(binary.BigEndian.Uint64(buf[:])) / float64(^uint64(0))
	return Backoff(attempt, unit)
}

// Backoff returns the delay for attempt using unit in [0, 1).
func Backoff(attempt int, unit float64) time.Duration {
	if attempt < 0 {
		attempt = 0
	}
	if attempt > 5 {
		attempt = 5
	}
	if unit < 0 {
		unit = 0
	}
	if unit > 1 {
		unit = 1
	}
	base := time.Second * time.Duration(1<<attempt)
	if base > 30*time.Second {
		base = 30 * time.Second
	}
	delta := float64(base) * 0.2
	return time.Duration(float64(base) - delta + 2*delta*unit)
}
