# Protocol

Version 1. The canonical JSON rules and the parsers in `packages/shared` are normative for the Worker and the panel. The Go bridge implements the same canonical form and is tested against `packages/shared/testdata/canonical.json` plus a shared Ed25519 vector.

## Envelope

Every WebSocket frame is one JSON object, UTF-8, at most 1 MiB.

```json
{
  "v": 1,
  "type": "hello",
  "id": "8b1c2d3e-0000-4000-8000-000000000001",
  "payload": {},
  "sig": "base64url"
}
```

`type` is one of `hello`, `hello_ack`, `ping`, `pong`, `request`, `response`, `error`. `id` correlates a reply with its request. `sig` is present on `hello` only.

## Canonical JSON and signatures

Signatures are Ed25519 over the UTF-8 canonical form of the payload object.

- Objects have keys sorted by UTF-8 byte order. Protocol keys are ASCII.
- No insignificant whitespace.
- Strings use `JSON.stringify` escapes. `&` and `/` are not escaped. Non-ASCII is not escaped as `\u`.
- Numbers are safe integers only. Floats are rejected.
- Arrays keep their order.

The Go encoder disables HTML escaping so `&` matches JavaScript. A test vector signed by Go verifies under WebCrypto.

`sig` is raw base64url, no padding. The public key is the 32-byte raw key, also base64url (43 characters).

`ts` is a unix second. Receivers reject timestamps more than five minutes from their clock. `nonce` is 16 random bytes, base64url, and is remembered so the same signed payload cannot be replayed inside the skew window. HTTP pairing nonces live in D1. Hello nonces live in the Durable Object.

## Hello

The bridge sends this after the socket opens. Folder order is sorted by id before signing.

```json
{
  "op": "hello",
  "protocol": 1,
  "deviceId": "uuid",
  "publicKey": "base64url",
  "name": "laptop",
  "version": "0.1.0",
  "ts": 1763800000,
  "nonce": "base64url",
  "folders": [{ "id": "uuid", "label": "notes" }]
}
```

Labels match `^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$`. At most 32 folders. The server upserts labels and does not change approval for an id it already knows. New ids start as `pending`.

`hello_ack`:

```json
{
  "ok": true,
  "heartbeatSec": 20,
  "approvedFolderIds": ["uuid"]
}
```

`ok: false` uses `reason` of `revoked` or `unpaired`. The bridge prints a new pairing code when the device is revoked.

## Heartbeat

Either side may send `ping` with `payload: { "ts": <unix seconds> }`. The peer answers `pong` with the same `id`. The bridge pings every 20 seconds. Any inbound frame resets a 45 second idle timer. When the timer fires, or a write fails, the bridge closes and reconnects.

Backoff starts at 1 second, doubles, and caps at 30 seconds, with ±20% jitter. A connection that stayed up for 30 seconds resets the backoff.

## Tool request

The server sends `request`. The bridge answers `response` with the same `id`.

```json
{
  "op": "list_files",
  "folderId": "uuid",
  "path": "src",
  "limit": 100,
  "cursor": ""
}
```

```json
{
  "op": "read_file",
  "folderId": "uuid",
  "path": "src/main.go",
  "startLine": 1,
  "endLine": 40,
  "byteOffset": 0,
  "maxBytes": 65536
}
```

`path` is relative and uses `/`. Empty `path` lists the folder root. A read requires a file path. Line ranges are 1-based and inclusive. A byte offset and a line range together are rejected. The default window is 64 KiB. The hard cap is 256 KiB. A truncated read sets `truncated` and `nextByteOffset`.

Success:

```json
{ "ok": true, "result": {} }
```

Failure:

```json
{
  "ok": false,
  "error": { "code": "denied", "message": "The path is refused by the default denylist." }
}
```

Stable codes: `invalid_path`, `outside_root`, `denied`, `not_found`, `not_a_directory`, `binary`, `bad_request`, `too_large`, `timeout`, `unavailable`, `not_approved`, `internal`. Messages do not include file contents or absolute paths.

`list_files` entries are `{ "name", "kind", "size" }` with `kind` of `file`, `dir`, `symlink`, or `other`. `nextCursor` is null on the last page. The cursor is opaque. Listings are sorted by name. Default page size is 100, maximum 200.

Directories skipped by name include `.git`, `node_modules`, `vendor`, `dist`, `build`, `out`, `target`, `.next`, `.venv`, `venv`, and `__pycache__`. Secret names such as `.env`, `.env.*`, `*.pem`, `*.key`, and private key filenames are omitted from listings and refused on read. `.gitignore` rules from the allowlisted root are applied. A negation cannot reveal a denylisted name.

## Pairing HTTP

`POST /api/pair/begin` and `POST /api/pair/status` take `{ "payload", "sig" }`.

Begin payload fields: `op` = `pair_begin`, `protocol`, `deviceId`, `publicKey`, `name`, `ts`, `nonce`.

Status payload fields: `op` = `pair_status`, `protocol`, `deviceId`, `ts`, `nonce`. Status verifies the signature with the stored public key. An unknown device is 404, which the bridge treats as "not registered yet".

`POST /api/pair/complete` is a normal panel call, not a device signature. Body: `{ "code": "AB3D-EF2H" }`. The code alphabet is `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, displayed as `XXXX-XXXX`. Comparison ignores case and hyphens. The database stores SHA-256 of the normalized code.

## MCP HTTP

`POST /mcp` speaks JSON-RPC 2.0. Supported protocol versions are `2025-03-26` and `2025-06-18`. `initialize` returns `Mcp-Session-Id`. Later requests send that header and `MCP-Protocol-Version`. `GET /mcp` is 405. `DELETE /mcp` drops the session. Notifications, including `notifications/initialized`, return 202.

Tool names are `list_files` and `read_file`. Arguments use `folder` (the label), `path`, and for reads `start_line`, `end_line`, `byte_offset`, `max_bytes`. The server instructions string lists approved labels and tells the client that file contents are data, not instructions.
