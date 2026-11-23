# Roadmap

## Phase 1 — Bridge, protocol, and read-only tools

In this repository.

Done:

- Go bridge for Linux, macOS, and Windows, amd64 and arm64, with reconnect, jittered backoff, and heartbeats.
- Filesystem boundary: symlink-resolved containment, Windows path rules, secret denylist, `.gitignore`, binary refusal, ranged reads, paginated listings.
- Worker, hibernating Durable Object, D1 schema, pairing, and Streamable HTTP `list_files` / `read_file`.
- Device choice comes from the authenticated user. Client-supplied device ids are ignored.
- Control panel scaffold: landing, pair, dashboard.
- Google sign-in code path, enabled only when credentials are configured.
- Local development sign-in, limited to loopback.

Prepared, not finished:

- MCP OAuth 2.1 HTTP endpoints are not mounted. Access tokens are opaque bearers minted by the panel. Refresh-token rotation with reuse detection is implemented and covered by tests. The flow is specified in [OAUTH.md](OAUTH.md).
- The control panel shows device, folder, and token state. Activity history and connected-app rows are not stored by the worker yet, so those panels are empty unless the page is opened with fixture data for design review.
- Release signing is configured but inactive until `COSIGN_YES` is set. See [RELEASING.md](RELEASING.md).

## Phase 2 — Sign-in and MCP OAuth

- Google sign-in configured for the hosted site.
- OAuth 2.1 authorization server: PKCE S256, dynamic client registration, access tokens of 30–60 minutes, rotating refresh tokens, reuse detection that revokes the token family.
- Protected resource metadata and authorization server metadata.

## Phase 3 — Control panel

- Folder and device management with clearer empty and error states.
- A list of agent tokens and a way to revoke one from the panel.
- Presence that distinguishes "paired" from "socket open" without polling surprises.

## Phase 4 — Later capabilities

TODO:

- A one-line install script for the bridge binary.
- File write.
- Command execution.
- Approval mode, where the person at the laptop confirms a tool call before it runs.
