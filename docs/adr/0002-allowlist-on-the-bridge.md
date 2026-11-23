# ADR 0002: Enforce the folder allowlist on the bridge

## Status

Accepted

## Context

The server is a convenient place to keep labels and approval, and a bad place to trust with path expansion. A bug or a compromised worker must not be able to name `~/.ssh` just because the laptop is connected.

## Decision

Folders are added by the bridge CLI. The config stores the real path locally. Hello advertises id and label only. The worker can approve, revoke, or hide a label. Every read resolves symlinks and requires the result to stay inside a locally configured root. The worker never accepts a filesystem path from the panel.

## Consequences

Approval is not a cryptographic limit against a hostile server the user chose to connect to. It is a limit against a normal server and against a confused client. The security document says this plainly. Users allowlist projects, not their home directory.
