#!/usr/bin/env bash
# Drives the local vertical slice against a worker that is already running.
# Start it first: pnpm --filter @mcp-bridge/worker dev
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SERVER=${SERVER:-http://127.0.0.1:8787}
HOME_DIR=$(mktemp -d)
PROJ=$(mktemp -d)
mkdir -p "$PROJ/notes"
printf 'hello from the bridge\n' > "$PROJ/notes/hello.txt"
printf 'SUPERSECRETVALUE\n' > "$PROJ/notes/.env"

export MCP_BRIDGE_HOME="$HOME_DIR"
(
  cd "$ROOT/apps/bridge"
  go run ./cmd/bridge --server "$SERVER" allow "$PROJ/notes" --label notes
  go run ./cmd/bridge --server "$SERVER"
) >"$HOME_DIR/bridge.log" 2>&1 &
BRIDGE_PID=$!
cleanup() {
  kill "$BRIDGE_PID" >/dev/null 2>&1 || true
  wait "$BRIDGE_PID" 2>/dev/null || true
}
trap cleanup EXIT

code=""
for _ in $(seq 1 40); do
  if grep -q "Pairing code:" "$HOME_DIR/bridge.log"; then
    code=$(grep "Pairing code:" "$HOME_DIR/bridge.log" | tail -1 | awk '{print $3}')
    break
  fi
  sleep 0.5
done
if [[ -z "$code" ]]; then
  echo "bridge did not print a pairing code" >&2
  cat "$HOME_DIR/bridge.log" >&2
  exit 1
fi

pair=$(curl -fsS -X POST "$SERVER/api/dev/pair" -H 'content-type: application/json' -d "{\"code\":\"$code\"}")
token=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["token"])' "$pair")

for _ in $(seq 1 40); do
  if grep -q "^Connected\." "$HOME_DIR/bridge.log"; then
    break
  fi
  sleep 0.5
done
grep -q "^Connected\." "$HOME_DIR/bridge.log"

folders=$(curl -fsS "$SERVER/api/folders" -H "authorization: Bearer $token")
fid=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["folders"][0]["id"])' "$folders")
curl -fsS -X POST "$SERVER/api/folders/$fid/approval" \
  -H "authorization: Bearer $token" -H 'content-type: application/json' \
  -d '{"approval":"approved"}' >/dev/null

curl -fsS -D "$HOME_DIR/headers" "$SERVER/mcp" \
  -H "authorization: Bearer $token" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"e2e","version":"0"}}}' \
  >"$HOME_DIR/init.json"
sid=$(awk 'tolower($1)=="mcp-session-id:" {print $2}' "$HOME_DIR/headers" | tr -d '\r')

call() {
  curl -fsS "$SERVER/mcp" \
    -H "authorization: Bearer $token" \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -H 'mcp-protocol-version: 2025-03-26' \
    -H "mcp-session-id: $sid" \
    -d "$1"
}

read_ok=$(call '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_file","arguments":{"folder":"notes","path":"hello.txt","deviceId":"ignore-me"}}}')
printf '%s' "$read_ok" | grep -q "hello from the bridge"
denied=$(call '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"read_file","arguments":{"folder":"notes","path":".env"}}}')
printf '%s' "$denied" | grep -q "denylist"
if printf '%s' "$denied" | grep -q "SUPERSECRETVALUE"; then
  echo "secret contents leaked" >&2
  exit 1
fi
echo "e2e ok"
