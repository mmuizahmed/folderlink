# Self-hosting FolderLink

FolderLink fits a free Cloudflare account: one Worker, SQLite Durable Objects, and one D1 database. That Worker also serves the website.

## Production config

`apps/worker/wrangler.toml` has two configs.

The top of the file is for `wrangler dev`. `WEB_ORIGIN` is the Vite app on `http://localhost:5173`, and `database_id` is a local placeholder.

`[env.production]` is what `wrangler deploy --env production` ships. For this product it sets:

- `WEB_ORIGIN` and `PUBLIC_BASE_URL` to `https://folderlink.muiz.pk`
- `workers_dev = false`
- custom domains for `folderlink.muiz.pk` and `mcp.muiz.pk`
- D1 binding `DB`, database name `folderlink`, database id `b7fd5f9d-7bf6-456b-a37f-125c18b5deb9`

A self-hosted copy creates its own database and pastes the printed id into `[[env.production.d1_databases]]`:

```bash
pnpm --filter @folderlink/worker exec wrangler d1 create folderlink
```

Leave `DEV_AUTH` unset. That switch is only for localhost. `node scripts/deploy-preflight.mjs` rejects a production config that still has the placeholder database id `00000000-0000-0000-0000-000000000001`, a `WEB_ORIGIN` or `PUBLIC_BASE_URL` on localhost or `127.0.0.1`, or `DEV_AUTH`.

For Google sign-in, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The redirect URI is `{PUBLIC_BASE_URL}/api/auth/google/callback`.

## Website and API on one host

The production Worker serves `apps/web/dist` with Workers Static Assets. A path with no file falls back to the single-page app. The worker runs first on every request: API, MCP, device, and health routes stay in the worker, and other paths are read from the asset binding. A request whose host is `mcp.muiz.pk` is a 301 to the same path and query on `https://folderlink.muiz.pk`. The panel calls `/api` on the same origin, and the Worker allows that origin along with `WEB_ORIGIN`.

`pnpm setup` prints the same commands. `pnpm setup --apply` runs them in this terminal.

Build the site, apply the remote migrations, then deploy:

```bash
pnpm --filter @folderlink/web build
pnpm --filter @folderlink/worker exec wrangler d1 migrations apply folderlink --env production --remote
pnpm --filter @folderlink/worker exec wrangler deploy --env production
```

## Manual deploy

`.github/workflows/deploy.yml` starts only from `workflow_dispatch`. The job runs in the `production` environment, with a 15 minute limit, and only when the ref is `refs/heads/main` in `mmuizahmed/folderlink`. Deploys share the `deploy-production` concurrency group, and a deploy that is already running is left to finish. Add a required reviewer on the `production` environment before the first run.

The job checks the Wrangler config, builds the website, runs `wrangler whoami` and `wrangler d1 list`, applies migrations, then deploys. Put `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` on the `production` environment.

## Laptop

```bash
folderlink --server https://your-host
```

People using your server add the connector at `https://your-host/mcp`.

An account is `active` or `suspended`. A suspended account cannot sign in or call tools.
