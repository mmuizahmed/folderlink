# Self-hosting FolderLink

FolderLink fits a free Cloudflare account: one Worker, SQLite Durable Objects, and one D1 database. The website is static files on any host.

## Worker

1. Create a D1 database named `folderlink` and put its id in `apps/worker/wrangler.toml`.
2. Set `WEB_ORIGIN` to the website origin and `PUBLIC_BASE_URL` to the Worker origin.
3. Leave `DEV_AUTH` unset. That switch is only for localhost.
4. For Google sign-in, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The redirect URI is `{PUBLIC_BASE_URL}/api/auth/google/callback`.
5. Apply the migrations and deploy:

```bash
pnpm --filter @mcp-bridge/worker exec wrangler d1 migrations apply folderlink --remote
pnpm --filter @mcp-bridge/worker exec wrangler deploy
```

The same deploy is the manual workflow in `.github/workflows/deploy.yml`.

## Website

```bash
pnpm --filter @mcp-bridge/web build
```

Host `apps/web/dist` on a static host whose origin matches `WEB_ORIGIN`. The Worker does not serve the website.

## Laptop

```bash
folderlink --server https://your-host
```

People using your server add the connector at `https://your-host/mcp`.

An account is `active` or `suspended`. A suspended account cannot sign in or call tools.
