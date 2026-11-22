# Architecture

mcp-bridge has three deployable parts and one shared protocol package.

## Components

**Bridge (`apps/bridge`).** A Go process on the laptop. It owns the device key, the folder allowlist, and every filesystem read. It dials the worker, sends a signed hello, and answers tool requests. If the socket dies, it reconnects with exponential backoff and jitter.

**Worker (`apps/worker`).** A Cloudflare Worker. It terminates agent HTTP, checks bearer tokens in D1, and forwards a tool call to exactly one Durable Object. It also serves the pairing and control APIs the panel uses.

**Device Durable Object.** One SQLite-backed object per device. The object's name is the device id. It accepts the bridge's WebSocket with the Hibernation API, checks the hello signature, and holds the socket while the isolate is evicted. Tool calls are RPC methods on that object: it writes a request frame and waits for the matching response.

**Control panel (`apps/web`).** A Vite + React shell. Landing, pairing, and a dashboard for devices, folder approval, and a one-time agent token. It does not display filesystem paths because the API never returns them.

**Shared package (`packages/shared`).** Canonical JSON, message parsers, and pairing-code rules. The Go module mirrors the canonical form and is checked against the same test vectors.

## Tool-call path

1. The agent sends a Streamable HTTP JSON-RPC request to `POST /mcp` with `Authorization: Bearer …`.
2. The worker hashes the token and loads the user from D1. A missing, expired, or revoked token is 401. A suspended account is 403. The MCP route does not accept the panel session cookie.
3. `chooseDevice` keeps devices whose `user_id` is that user, whose status is `active`, and whose Durable Object reports a live authenticated socket. It returns the one with the latest `last_seen_at`. The function has no parameter for a client device id. Tool arguments are parsed with an allowlist of fields; `deviceId` in the arguments is ignored.
4. The folder label is resolved against folders listed by that device. Pending or revoked labels never reach the bridge.
5. The Durable Object sends a `request` frame. The bridge checks the folder id against its local config, then resolves the path.
6. The result comes back as a `response` frame and is wrapped as an MCP tool result.

## Pairing

1. First launch creates an Ed25519 key and a device id under the config directory.
2. `POST /api/pair/begin` is signed by that key. The worker stores the public key and returns an 8-character code, valid for 10 minutes.
3. A signed-in person submits the code. The device becomes `active` and is bound to that user.
4. The bridge opens `wss://<host>/device/<deviceId>/ws` and sends `hello`. The signature covers the canonical payload, including the folder labels.

A device that is already active cannot be moved by requesting a new code. After it is revoked, a new code can bind it again. Only the holder of the private key can obtain a code.

## What is stored where

| Store                 | Holds                                                                                                                                               | Does not hold                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Laptop config         | Real folder paths, device seed                                                                                                                      | Agent tokens                 |
| D1                    | Users, devices, public keys, folder labels and approval, hashed session and access tokens, hashed refresh tokens, pairing-code hashes, MCP sessions | Filesystem paths, raw tokens |
| Durable Object SQLite | Recent hello nonces, a last-seen throttle                                                                                                           | User records                 |

Access tokens are opaque, stored as SHA-256, and last 45 minutes (`TOKEN_TTL_SECONDS`, clamped to 60–3600, default 2700). Panel sessions last 14 days and are HTTP-only cookies. Mutations that rely on the cookie require `X-Requested-With: mcp-bridge`.

## Account state

`users.status` is `active` or `suspended`. Sign-in, pairing completion, bearer auth, and the device hello all refuse a suspended user. Nothing in this repository changes the column. An operator of a self-hosted database can update it directly.

## Why these Cloudflare choices

The free plan is the constraint. Durable Objects give one hibernating WebSocket per device without a paid always-on process. D1 is the token store because Workers KV on the free plan allows 1,000 writes per day, which a reconnecting fleet would burn through. The object class is created with `new_sqlite_classes` so the nonce table survives hibernation.

Google sign-in is implemented and does nothing until `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `PUBLIC_BASE_URL` are set. MCP OAuth 2.1 is specified in [OAUTH.md](OAUTH.md). The refresh-token rotation code is implemented and tested; the authorization-server routes are not mounted.

## Local development

`wrangler dev` applies the Worker on `http://127.0.0.1:8787`. Vite on port 5173 proxies `/api`. `DEV_AUTH=true` in `.dev.vars` enables `POST /api/dev/session` and `POST /api/dev/pair`, and only when both the URL host and the Host header are localhost. The bridge refuses a non-local `http://` server URL.

## Read boundary

The bridge resolves the allowlisted root and the requested path with `EvalSymlinks`, then requires the result to stay inside the root. On Linux it also checks `/proc/self/fd` after open, and it reads from that file descriptor. Symlinks that point outside are refused. FIFOs and other non-regular files are refused before a blocking open. The denylist and `.gitignore` rules run as well. See [SECURITY-MODEL.md](SECURITY-MODEL.md) for what this does not catch, such as hard links.
