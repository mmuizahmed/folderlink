import { base64Url, sha256Hex } from "../crypto.ts";
import { addSeconds, issueAccessToken, nowIso } from "../db.ts";
import type { Env } from "../env.ts";
import { publicBaseUrl } from "../env.ts";
import { createD1RefreshStore, issueRefreshToken, rotateRefreshToken } from "./refresh.ts";

export const READ_SCOPE = "folderlink:read";

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
}

export interface OAuthCode {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
  expiresAt: string;
}

export interface OAuthGrant {
  id: string;
  clientId: string;
  userId: string;
  scope: string;
  familyId: string;
  createdAt: string;
  revokedAt: string | null;
  name: string;
}

export interface OAuthStore {
  saveClient(client: OAuthClient): Promise<void>;
  client(id: string): Promise<OAuthClient | null>;
  saveCode(hash: string, code: OAuthCode): Promise<void>;
  takeCode(hash: string, now: string): Promise<OAuthCode | null>;
  saveGrant(grant: OAuthGrant): Promise<void>;
  grantForFamily(familyId: string): Promise<OAuthGrant | null>;
  grantsForUser(userId: string): Promise<OAuthGrant[]>;
  revokeGrant(id: string, userId: string, at: string): Promise<OAuthGrant | null>;
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [READ_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "FolderLink",
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [READ_SCOPE],
  };
}

export function metadataResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}

export function oauthError(status: number, error: string, description: string): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

export async function pkceS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function validVerifier(value: string): boolean {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

function allowedRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) {
    return false;
  }
  if (url.protocol === "https:") {
    return true;
  }
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

export async function registerClient(request: Request, store: OAuthStore): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthError(400, "invalid_client_metadata", "The registration body must be JSON.");
  }
  if (!body || typeof body !== "object") {
    return oauthError(400, "invalid_client_metadata", "The registration body must be JSON.");
  }
  const record = body as Record<string, unknown>;
  if (record.token_endpoint_auth_method && record.token_endpoint_auth_method !== "none") {
    return oauthError(400, "invalid_client_metadata", "Only public clients are accepted.");
  }
  const redirects = Array.isArray(record.redirect_uris) ? record.redirect_uris : [];
  if (
    redirects.length < 1 ||
    redirects.length > 8 ||
    redirects.some((item) => typeof item !== "string" || !allowedRedirect(item))
  ) {
    return oauthError(
      400,
      "invalid_redirect_uri",
      "Redirect URIs must be https, or localhost http.",
    );
  }
  const name =
    typeof record.client_name === "string" && record.client_name.trim().length > 0
      ? record.client_name.trim().slice(0, 80)
      : "AI app";
  const client: OAuthClient = {
    id: `oc_${crypto.randomUUID().replaceAll("-", "")}`,
    name,
    redirectUris: redirects as string[],
  };
  await store.saveClient(client);
  return new Response(
    JSON.stringify({
      client_id: client.id,
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    {
      status: 201,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    },
  );
}

interface AuthorizeQuery {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  scope: string;
  resource: string;
}

function readAuthorize(url: URL, origin: string): AuthorizeQuery | Response {
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const challenge = url.searchParams.get("code_challenge") ?? "";
  const method = url.searchParams.get("code_challenge_method") ?? "";
  const responseType = url.searchParams.get("response_type") ?? "";
  const scope = url.searchParams.get("scope") ?? READ_SCOPE;
  const resource = url.searchParams.get("resource") ?? `${origin}/mcp`;
  if (
    responseType !== "code" ||
    method !== "S256" ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(challenge)
  ) {
    return oauthError(400, "invalid_request", "PKCE S256 and response_type=code are required.");
  }
  if (scope.split(" ").some((item) => item && item !== READ_SCOPE)) {
    return oauthError(400, "invalid_scope", "The only scope is folderlink:read.");
  }
  if (resource !== `${origin}/mcp`) {
    return oauthError(400, "invalid_target", "The resource must be this server's MCP endpoint.");
  }
  if (!clientId || !redirectUri) {
    return oauthError(400, "invalid_request", "client_id and redirect_uri are required.");
  }
  return { clientId, redirectUri, state, challenge, scope: READ_SCOPE, resource };
}

export async function authorizeGet(
  request: Request,
  store: OAuthStore,
  user: { id: string; email?: string; name?: string; avatarUrl?: string } | null,
  origin: string,
): Promise<Response> {
  const url = new URL(request.url);
  const query = readAuthorize(url, origin);
  if (query instanceof Response) {
    return query;
  }
  const client = await store.client(query.clientId);
  if (!client || !client.redirectUris.includes(query.redirectUri)) {
    return oauthError(400, "invalid_request", "The client or redirect URI is not registered.");
  }
  if (!user) {
    const next = `${url.pathname}${url.search}`;
    return Response.redirect(`${origin}/api/auth/google?next=${encodeURIComponent(next)}`, 302);
  }
  const next = `${url.pathname}${url.search}`;
  return new Response(
    consentPage(client.name, query, {
      email: user.email ?? "",
      name: user.name ?? "",
      avatarUrl: user.avatarUrl ?? "",
      switchHref: `${origin}/api/auth/google?next=${encodeURIComponent(next)}`,
    }),
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

export async function authorizePost(
  request: Request,
  store: OAuthStore,
  user: { id: string } | null,
  origin: string,
): Promise<Response> {
  if (!user) {
    return oauthError(401, "login_required", "Sign in before allowing an app.");
  }
  const form = await readForm(request);
  const decision = form.get("decision") ?? "";
  const query = readAuthorize(formToUrl(form), origin);
  if (query instanceof Response) {
    return query;
  }
  const client = await store.client(query.clientId);
  if (!client || !client.redirectUris.includes(query.redirectUri)) {
    return oauthError(400, "invalid_request", "The client or redirect URI is not registered.");
  }
  const target = new URL(query.redirectUri);
  if (decision !== "allow") {
    target.searchParams.set("error", "access_denied");
    target.searchParams.set("state", query.state);
    return Response.redirect(target.toString(), 302);
  }
  const code = `ocd_${crypto.randomUUID().replaceAll("-", "")}`;
  await store.saveCode(await sha256Hex(code), {
    clientId: query.clientId,
    userId: user.id,
    redirectUri: query.redirectUri,
    codeChallenge: query.challenge,
    scope: query.scope,
    resource: query.resource,
    expiresAt: addSeconds(300),
  });
  target.searchParams.set("code", code);
  if (query.state) {
    target.searchParams.set("state", query.state);
  }
  return Response.redirect(target.toString(), 302);
}

function formToUrl(form: URLSearchParams): URL {
  const url = new URL("https://folderlink.muiz.pk/oauth/authorize");
  for (const [key, value] of form.entries()) {
    if (key !== "decision") {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

async function readForm(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get("content-type") ?? "";
  const text = await request.text();
  if (type.includes("application/json")) {
    const body = JSON.parse(text) as Record<string, unknown>;
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") {
        form.set(key, value);
      }
    }
    return form;
  }
  return new URLSearchParams(text);
}

export async function token(request: Request, store: OAuthStore, env: Env): Promise<Response> {
  const form = await readForm(request);
  const grant = form.get("grant_type") ?? "";
  const clientId = form.get("client_id") ?? "";
  const client = clientId ? await store.client(clientId) : null;
  if (!client) {
    return oauthError(401, "invalid_client", "The client is not registered.");
  }
  if (grant === "authorization_code") {
    return codeGrant(form, client, store, env);
  }
  if (grant === "refresh_token") {
    return refreshGrant(form, client, store, env);
  }
  return oauthError(400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
}

async function codeGrant(
  form: URLSearchParams,
  client: OAuthClient,
  store: OAuthStore,
  env: Env,
): Promise<Response> {
  const code = form.get("code") ?? "";
  const redirectUri = form.get("redirect_uri") ?? "";
  const verifier = form.get("code_verifier") ?? "";
  if (!code || !client.redirectUris.includes(redirectUri) || !validVerifier(verifier)) {
    return oauthError(400, "invalid_grant", "The authorization code is not valid.");
  }
  const row = await store.takeCode(await sha256Hex(code), nowIso());
  if (!row || row.clientId !== client.id || row.redirectUri !== redirectUri) {
    return oauthError(400, "invalid_grant", "The authorization code is not valid.");
  }
  const challenge = await pkceS256(verifier);
  if (challenge !== row.codeChallenge) {
    return oauthError(400, "invalid_grant", "The PKCE verifier does not match.");
  }
  return issuePair(env, store, row.userId, client, row.scope);
}

async function refreshGrant(
  form: URLSearchParams,
  client: OAuthClient,
  store: OAuthStore,
  env: Env,
): Promise<Response> {
  const raw = form.get("refresh_token") ?? "";
  if (!raw) {
    return oauthError(400, "invalid_grant", "A refresh token is required.");
  }
  const family = await familyOf(env, raw);
  const grant = family ? await store.grantForFamily(family) : null;
  if (!grant || grant.clientId !== client.id || grant.revokedAt) {
    if (grant) {
      await createD1RefreshStore(env.DB).revokeFamily(grant.familyId, nowIso());
    }
    return oauthError(400, "invalid_grant", "The refresh token is not valid.");
  }
  const rotated = await rotateRefreshToken(
    createD1RefreshStore(env.DB),
    raw,
    new Date(),
    60 * 24 * 3600,
  );
  if (!rotated.ok || rotated.userId !== grant.userId) {
    return oauthError(400, "invalid_grant", "The refresh token is not valid.");
  }
  const access = await issueAccessToken(env.DB, grant.userId, tokenTtl(env), grant.id);
  return tokenResponse(access.token, rotated.token, tokenTtl(env), grant.scope);
}

async function familyOf(env: Env, raw: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT family_id FROM refresh_tokens WHERE token_hash = ?`)
    .bind(await sha256Hex(raw))
    .first<{ family_id: string }>();
  return row?.family_id ?? null;
}

async function issuePair(
  env: Env,
  store: OAuthStore,
  userId: string,
  client: OAuthClient,
  scope: string,
): Promise<Response> {
  const familyId = crypto.randomUUID();
  const grantId = crypto.randomUUID();
  const refresh = await issueRefreshToken(
    createD1RefreshStore(env.DB),
    userId,
    familyId,
    new Date(),
    60 * 24 * 3600,
  );
  await store.saveGrant({
    id: grantId,
    clientId: client.id,
    userId,
    scope,
    familyId,
    createdAt: nowIso(),
    revokedAt: null,
    name: client.name,
  });
  const access = await issueAccessToken(env.DB, userId, tokenTtl(env), grantId);
  return tokenResponse(access.token, refresh.token, tokenTtl(env), scope);
}

function tokenResponse(
  access: string,
  refresh: string,
  expiresIn: number,
  scope: string,
): Response {
  return new Response(
    JSON.stringify({
      access_token: access,
      token_type: "Bearer",
      expires_in: expiresIn,
      refresh_token: refresh,
      scope,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    },
  );
}

function tokenTtl(env: Env): number {
  const parsed = Number(env.TOKEN_TTL_SECONDS ?? "2700");
  if (!Number.isFinite(parsed) || parsed < 60 || parsed > 3600) {
    return 2700;
  }
  return Math.floor(parsed);
}

export function mcpAuthenticateHeader(origin: string): string {
  const metadata = new URL("/.well-known/oauth-protected-resource", origin).toString();
  return `Bearer realm="folderlink", resource_metadata="${metadata}"`;
}

function consentPage(
  name: string,
  query: AuthorizeQuery,
  account: { email: string; name: string; avatarUrl: string; switchHref: string },
): string {
  const fields: Array<[string, string]> = [
    ["client_id", query.clientId],
    ["redirect_uri", query.redirectUri],
    ["state", query.state],
    ["code_challenge", query.challenge],
    ["code_challenge_method", "S256"],
    ["response_type", "code"],
    ["scope", query.scope],
    ["resource", query.resource],
  ];
  const hidden = fields
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`,
    )
    .join("");
  const domain = redirectHost(query.redirectUri);
  const who = escapeHtml(account.email || account.name || "your account");
  const avatar = account.avatarUrl
    ? `<img class="avatar" alt="" src="${escapeHtml(account.avatarUrl)}">`
    : `<span class="avatar">${escapeHtml(initials(account.name, account.email))}</span>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Allow ${escapeHtml(name)} · FolderLink</title>
  <style>
    body { margin: 0; min-height: 100vh; background: #09090b; color: #ededef; font: 15px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; }
    header { height: 56px; display: flex; align-items: center; padding: 0 24px; border-bottom: 1px solid #232327; }
    .brand { display: flex; align-items: center; gap: 10px; color: inherit; text-decoration: none; font-weight: 600; }
    main { min-height: calc(100vh - 57px); display: grid; place-items: center; padding: 32px 16px; }
    .panel { width: min(440px, 100%); border: 1px solid #232327; border-radius: 16px; background: #111113; padding: 24px; }
    .who { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
    .avatar { width: 36px; height: 36px; border-radius: 50%; background: #17171a; display: grid; place-items: center; font-size: 12px; object-fit: cover; }
    .who p { margin: 0; color: #8d8d96; font-size: 12px; }
    .who a { margin-left: auto; color: #9a9aa3; font-size: 13px; }
    h1 { font-size: 28px; letter-spacing: -0.03em; margin: 0 0 8px; }
    p { color: #9a9aa3; }
    .scope { border: 1px solid #232327; border-radius: 12px; padding: 16px; margin: 20px 0; }
    strong { color: #ededef; }
    .row { display: flex; gap: 12px; }
    button { height: 40px; border-radius: 6px; border: 0; padding: 0 16px; font: inherit; cursor: pointer; }
    .allow { background: #ededef; color: #09090b; }
    .deny { background: transparent; color: #9a9aa3; box-shadow: inset 0 0 0 1px #232327; }
  </style>
</head>
<body>
  <header>
    <a class="brand" href="/">
      <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true"><path fill="#F2F4F7" d="M6 2h32a5 5 0 0 1 5 5v3a5 5 0 0 1-5 5H16v11h8a4 4 0 0 1 4 4v8a8 8 0 0 1-8 8H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z"/><path fill="#22C55E" d="M36 22h18a5 5 0 0 1 5 5v27a5 5 0 0 1-5 5H26a4 4 0 0 1-4-4l10-24a5 5 0 0 1 4-5z"/></svg>
      FolderLink
    </a>
  </header>
  <main>
    <section class="panel">
      <div class="who">
        ${avatar}
        <div>
          <p>Signed in as</p>
          <strong>${who}</strong>
        </div>
        <a href="${escapeHtml(account.switchHref)}">Not you?</a>
      </div>
      <h1>Allow ${escapeHtml(name)}</h1>
      <p>${escapeHtml(name)} at ${escapeHtml(domain)} wants read-only access to the folders you approve.</p>
      <div class="scope">
        <div>Scope</div>
        <strong>Read folders you approve</strong>
        <p>It cannot change files, and it cannot see folders you have not turned on.</p>
      </div>
      <form method="post" action="/oauth/authorize">
        ${hidden}
        <div class="row">
          <button class="deny" name="decision" value="deny" type="submit">Deny</button>
          <button class="allow" name="decision" value="allow" type="submit">Allow</button>
        </div>
      </form>
    </section>
  </main>
</body>
</html>`;
}

function redirectHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

function initials(name: string, email: string): string {
  const source = name.trim() || email.trim() || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function createD1OAuthStore(db: D1Database): OAuthStore {
  return {
    async saveClient(client) {
      await db
        .prepare(
          `INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)`,
        )
        .bind(client.id, client.name, JSON.stringify(client.redirectUris), nowIso())
        .run();
    },
    async client(id) {
      const row = await db
        .prepare(`SELECT id, name, redirect_uris FROM oauth_clients WHERE id = ?`)
        .bind(id)
        .first<{ id: string; name: string; redirect_uris: string }>();
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        redirectUris: JSON.parse(row.redirect_uris) as string[],
      };
    },
    async saveCode(hash, code) {
      await db
        .prepare(
          `INSERT INTO oauth_codes
            (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          hash,
          code.clientId,
          code.userId,
          code.redirectUri,
          code.codeChallenge,
          code.scope,
          code.resource,
          code.expiresAt,
        )
        .run();
    },
    async takeCode(hash, now) {
      const row = await db
        .prepare(
          `SELECT client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at
           FROM oauth_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`,
        )
        .bind(hash, now)
        .first<{
          client_id: string;
          user_id: string;
          redirect_uri: string;
          code_challenge: string;
          scope: string;
          resource: string;
          expires_at: string;
        }>();
      if (!row) return null;
      const claimed = await db
        .prepare(`UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL`)
        .bind(now, hash)
        .run();
      if ((claimed.meta.changes ?? 0) < 1) return null;
      return {
        clientId: row.client_id,
        userId: row.user_id,
        redirectUri: row.redirect_uri,
        codeChallenge: row.code_challenge,
        scope: row.scope,
        resource: row.resource,
        expiresAt: row.expires_at,
      };
    },
    async saveGrant(grant) {
      await db
        .prepare(
          `INSERT INTO oauth_grants
            (id, client_id, user_id, scope, refresh_family_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(grant.id, grant.clientId, grant.userId, grant.scope, grant.familyId, grant.createdAt)
        .run();
    },
    async grantForFamily(familyId) {
      const row = await db
        .prepare(
          `SELECT g.id, g.client_id, g.user_id, g.scope, g.refresh_family_id, g.created_at, g.revoked_at, c.name
           FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id
           WHERE g.refresh_family_id = ?`,
        )
        .bind(familyId)
        .first<{
          id: string;
          client_id: string;
          user_id: string;
          scope: string;
          refresh_family_id: string;
          created_at: string;
          revoked_at: string | null;
          name: string;
        }>();
      return row ? mapGrant(row) : null;
    },
    async grantsForUser(userId) {
      const rows = await db
        .prepare(
          `SELECT g.id, g.client_id, g.user_id, g.scope, g.refresh_family_id, g.created_at, g.revoked_at, c.name
           FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id
           WHERE g.user_id = ? AND g.revoked_at IS NULL
           ORDER BY g.created_at DESC`,
        )
        .bind(userId)
        .all<{
          id: string;
          client_id: string;
          user_id: string;
          scope: string;
          refresh_family_id: string;
          created_at: string;
          revoked_at: string | null;
          name: string;
        }>();
      return rows.results.map(mapGrant);
    },
    async revokeGrant(id, userId, at) {
      const existing = await db
        .prepare(
          `SELECT g.id, g.client_id, g.user_id, g.scope, g.refresh_family_id, g.created_at, g.revoked_at, c.name
           FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id
           WHERE g.id = ? AND g.user_id = ? AND g.revoked_at IS NULL`,
        )
        .bind(id, userId)
        .first<{
          id: string;
          client_id: string;
          user_id: string;
          scope: string;
          refresh_family_id: string;
          created_at: string;
          revoked_at: string | null;
          name: string;
        }>();
      if (!existing) return null;
      await db
        .prepare(`UPDATE oauth_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
        .bind(at, id)
        .run();
      await db
        .prepare(
          `UPDATE access_tokens SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL`,
        )
        .bind(at, id)
        .run();
      await createD1RefreshStore(db).revokeFamily(existing.refresh_family_id, at);
      return mapGrant({ ...existing, revoked_at: at });
    },
  };
}

function mapGrant(row: {
  id: string;
  client_id: string;
  user_id: string;
  scope: string;
  refresh_family_id: string;
  created_at: string;
  revoked_at: string | null;
  name: string;
}): OAuthGrant {
  return {
    id: row.id,
    clientId: row.client_id,
    userId: row.user_id,
    scope: row.scope,
    familyId: row.refresh_family_id,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    name: row.name,
  };
}

export function issuer(env: Env): string {
  return publicBaseUrl(env).replace(/\/$/, "");
}

export function originOf(request: Request, env: Env): string {
  const url = new URL(request.url);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return url.origin;
  }
  return issuer(env);
}
