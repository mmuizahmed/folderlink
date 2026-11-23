# ADR 0005: Store opaque tokens in D1

## Status

Accepted

## Context

Agents need a credential the worker can check without a session cookie, and the credential must be revocable and short-lived.

## Decision

Access tokens and panel sessions are random bearer strings. D1 stores SHA-256 only. Access tokens last 45 minutes. The table for rotating refresh tokens is in the first migration even though the OAuth routes are not mounted; the rotation function is tested so the reuse rule is fixed before those routes exist.

## Consequences

A database read is required to authenticate. That is acceptable at this size. Leaking the database does not reveal raw tokens. Leaking a token still works until expiry or until the device is revoked, which is documented.
