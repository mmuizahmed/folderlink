# Development

You need Node.js 22, pnpm 10, and Go 1.22.

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

`pnpm test` runs the TypeScript tests and `go test ./...` in `apps/bridge`. CI also runs `golangci-lint`. Format Go with `gofmt`.

## Run it locally

```bash
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
pnpm --filter @mcp-bridge/worker exec wrangler d1 migrations apply folderlink --local
```

Terminal 1, the worker:

```bash
pnpm dev:worker
```

Wait until it prints `Ready on http://127.0.0.1:8787`.

Terminal 2, the website:

```bash
pnpm dev:web
```

Open http://localhost:5173. Google sign-in stays off until client credentials exist. On localhost, use the local development session, then enter the pairing code.

Terminal 3, FolderLink. Use an empty config directory:

```bash
export FOLDERLINK_HOME=/tmp/folderlink-home
mkdir -p /tmp/demo-notes
printf 'hello from the laptop\n' > /tmp/demo-notes/hello.txt
printf 'SUPERSECRETVALUE\n' > /tmp/demo-notes/.env

cd apps/bridge
go run ./cmd/bridge --server http://127.0.0.1:8787 allow /tmp/demo-notes --label notes
go run ./cmd/bridge --server http://127.0.0.1:8787
```

The process opens your browser at `/pair?code=...`. Sign in there and choose Allow. FolderLink then prints `Connected.` Approve the folder from the dashboard. Nothing in this repository issues a token for you to copy.

## Call a tool

An AI app receives an access token from `POST /oauth/token` after you choose Allow. Streamable HTTP answers a single JSON body. `TOKEN` below is that OAuth access token.

```bash
curl -sS -D - http://127.0.0.1:8787/mcp \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

Copy `mcp-session-id` from the response headers, then:

```bash
curl -sS http://127.0.0.1:8787/mcp \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'mcp-protocol-version: 2025-03-26' \
  -H "mcp-session-id: SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_file","arguments":{"folder":"notes","path":"hello.txt"}}}'
```

`hello.txt` returns its text. The same call with `path` set to `.env`, or to a symlink that leaves the folder, returns an error and no file contents. `list_files` omits blocked names.

`scripts/e2e-local.sh` runs that sequence against a worker that is already up. It is not part of CI. `scripts/e2e-full.mjs` starts the worker and a real binary. That script runs in CI. The matrix is [TEST-MATRIX.md](TEST-MATRIX.md).

MCP clients discover `/.well-known/oauth-protected-resource` and sign in with OAuth. `POST /api/dev/session` only starts a localhost browser session when `DEV_AUTH=true`. It does not create an access token.

Development sign-in exists only when `DEV_AUTH=true` and the request host is localhost. Do not set `DEV_AUTH` on a public deployment.

## Commands

```text
folderlink allow <directory> --label notes
folderlink unallow notes
folderlink folders
folderlink status
folderlink version
```

Config and the device key live in `$FOLDERLINK_HOME`, or under `folderlink` in the user config directory. The key file is mode `0600`.
