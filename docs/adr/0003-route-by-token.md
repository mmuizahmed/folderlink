# ADR 0003: Route tool calls from the token, not from a client device id

## Status

Accepted

## Context

An agent that can pass `deviceId` can ask for another tenant's laptop if the server trusts that field.

## Decision

The MCP bearer token is resolved to a user. `chooseDevice` selects among that user's active, connected devices and takes no client device id. The tool parser copies `folder`, `path`, and range fields only. The bridge's own WebSocket still addresses its Durable Object by device id, and then proves the private key in `hello`.

## Consequences

A user with two online devices is served by the one that checked in most recently. Picking a device by name in the tool call is phase 3 work, and it will still be filtered to the token's user.
