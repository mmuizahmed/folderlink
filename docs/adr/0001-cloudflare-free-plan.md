# ADR 0001: Host the control plane on Cloudflare's free plan

## Status

Accepted

## Context

The audience is about 10–15 students. A paid always-on VM is the wrong default, and the laptop must be the side that dials out.

## Decision

One Worker, one SQLite-backed Durable Object per device using the WebSocket Hibernation API, and D1 for users, devices, sessions, and tokens. Workers KV is not used for tokens: the free plan allows 1,000 KV writes per day. Static hosting for the panel can be Pages or any static host; phase 1 builds a Vite app and does not bundle it into the Worker.

## Consequences

The WebSocket survives isolate eviction, so pending request state cannot live only in memory across hibernation. Tool calls wait inside an RPC while the object is awake. D1 write volume has to stay modest, so `last_seen_at` is throttled to about twice a minute per device.
