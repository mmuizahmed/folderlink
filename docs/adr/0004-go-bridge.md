# ADR 0004: Write the bridge in Go

## Status

Accepted

## Context

The laptop program has to be one file a student can download, for Windows, macOS, and Linux, on amd64 and arm64, and stay small.

## Decision

Go, `CGO_ENABLED=0`, trimmed symbols. The filesystem and WebSocket client use the standard library plus `github.com/coder/websocket`. Ed25519 is `crypto/ed25519`.

## Consequences

Protocol types are duplicated in Go and TypeScript. Shared JSON fixtures and a signature vector keep the canonical form aligned. A stripped linux/amd64 binary of this phase is about 5.5 MB.
