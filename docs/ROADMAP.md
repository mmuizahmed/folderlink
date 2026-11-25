# Roadmap

## Phase 1 — Bridge, protocol, and read-only tools

In this repository.

Done:

- Go bridge for Linux, macOS, and Windows, amd64 and arm64, with reconnect, jittered backoff, and heartbeats.
- Filesystem boundary: symlink-resolved containment, Windows path rules, secret denylist, `.gitignore`, binary refusal, ranged reads, paginated listings.
- Worker, hibernating Durable Object, D1 schema, pairing, and Streamable HTTP `list_files` / `read_file`.
- Device choice comes from the authenticated user. Client-supplied device ids are ignored.
- Control panel: landing, pair, and dashboard.
- Google sign-in code path, enabled only when credentials are configured.
- Local development sign-in, limited to loopback.

Prepared, not finished:

- MCP OAuth 2.1 HTTP endpoints are mounted and live: authorization, token, dynamic client registration, revocation, and protected-resource metadata. Verified end to end on Nov 23, 2026 with a real client connection (ChatGPT/Claude-style OAuth 2.0 authorization-code flow against https://folderlink.muiz.pk). Access tokens are opaque bearers minted by the panel. Refresh-token rotation with reuse detection is implemented and covered by tests. The flow is specified in [OAUTH.md](OAUTH.md).
- The control panel shows device, folder, and token state. Activity history is stored by the worker in the `activity` D1 table (one row per tool call, metadata only, 30-day retention) and shown in the dashboard Activity panel; connected-app rows come from stored OAuth grants.
- Release signing is configured but inactive until `COSIGN_YES` is set. See [RELEASING.md](RELEASING.md).

## Phase 2 — Sign-in and MCP OAuth

Done (Nov 23, 2026, verified with a real client connection):

- Google sign-in configured for the hosted site.
- OAuth 2.1 authorization server: PKCE S256, dynamic client registration, access tokens of 30–60 minutes, rotating refresh tokens, reuse detection that revokes the token family.
- Protected resource metadata and authorization server metadata.

## Phase 3 — Control panel

- Folder and device management with clearer empty and error states.
- A list of agent tokens and a way to revoke one from the panel.
- Presence that distinguishes "paired" from "socket open" without polling surprises. Done: the worker records each device's last-seen time from bridge heartbeats (D1 `last_seen_at`), the dashboard shows online/offline from it, and the MCP offline error reports when the device was last seen instead of only "no device connected".

## Phase 4 — Later capabilities

Done:

- A one-line install script for the bridge binary.
- File write.
- Command execution.
- Approval mode, where the person at the laptop confirms a tool call before it runs. Every write needs dashboard approval; the mode setting (AI approval or manual approval) is in the dashboard Settings.
