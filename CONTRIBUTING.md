# Contributing

Thanks for helping with mcp-bridge. The project is a small Go program, a Cloudflare Worker, and a web control panel in one pnpm workspace.

## Setup

- Node.js 22 or newer
- pnpm 10
- Go 1.22 or newer

```bash
pnpm install
cd apps/bridge && go test ./...
```

Copy `apps/worker/.dev.vars.example` to `apps/worker/.dev.vars` before running the worker locally. The example file turns on development sign-in for localhost only.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
```

`pnpm test` runs the TypeScript tests and `go test ./...` in `apps/bridge`. Go code is formatted with `gofmt`. CI also runs `golangci-lint`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat: add ranged file reads
fix: reject symlink escapes from an allowed folder
docs: describe the pairing flow
```

Keep each commit focused. Do not mix an unrelated refactor into a bug fix.

## Pull requests

Describe what changed, how you tested it, and whether any security boundary moved. Path checks, authentication, and device routing need tests when they change.

## Security

Please do not file public issues for vulnerabilities. See `SECURITY.md`.
