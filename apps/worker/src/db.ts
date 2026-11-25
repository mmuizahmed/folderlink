import { PAIRING_ALPHABET, formatPairingCode, normalizePairingCode } from "@folderlink/shared";
import { sha256Hex } from "./crypto.ts";
import type { FolderRow } from "./routing.ts";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string;
  google_sub: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface DeviceRecord {
  id: string;
  user_id: string | null;
  public_key: string;
  name: string;
  status: string;
  paired_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
  os: string;
  arch: string;
  client_ip: string;
  client_region: string;
  client_version: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export async function getUser(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

export async function upsertGoogleUser(
  db: D1Database,
  profile: { sub: string; email: string; name: string; picture: string },
): Promise<UserRow> {
  const existing = await db
    .prepare("SELECT * FROM users WHERE google_sub = ? OR email = ?")
    .bind(profile.sub, profile.email)
    .first<UserRow>();
  const ts = nowIso();
  if (existing) {
    await db
      .prepare(
        `UPDATE users SET email = ?, name = ?, avatar_url = ?, google_sub = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(profile.email, profile.name, profile.picture, profile.sub, ts, existing.id)
      .run();
    const updated = await getUser(db, existing.id);
    if (!updated) {
      throw new Error("user disappeared");
    }
    return updated;
  }
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO users (id, email, name, avatar_url, google_sub, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .bind(id, profile.email, profile.name, profile.picture, profile.sub, ts, ts)
    .run();
  const created = await getUser(db, id);
  if (!created) {
    throw new Error("user was not created");
  }
  return created;
}

export async function ensureLocalUser(
  db: D1Database,
  email: string,
  name: string,
): Promise<UserRow> {
  const existing = await db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(email)
    .first<UserRow>();
  if (existing) {
    return existing;
  }
  const ts = nowIso();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO users (id, email, name, avatar_url, status, created_at, updated_at)
       VALUES (?, ?, ?, '', 'active', ?, ?)`,
    )
    .bind(id, email, name, ts, ts)
    .run();
  const created = await getUser(db, id);
  if (!created) {
    throw new Error("local user was not created");
  }
  return created;
}

export async function ensureDevUser(db: D1Database): Promise<UserRow> {
  return ensureLocalUser(db, "dev@localhost", "Local dev");
}

export async function createSession(
  db: D1Database,
  userId: string,
  rawToken: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      await sha256Hex(rawToken),
      addSeconds(14 * 24 * 3600),
      nowIso(),
    )
    .run();
}

export async function userForSession(db: D1Database, rawToken: string): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT users.* FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .bind(await sha256Hex(rawToken), nowIso())
    .first<UserRow>();
}

export async function deleteSession(db: D1Database, rawToken: string): Promise<void> {
  await db
    .prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(await sha256Hex(rawToken))
    .run();
}

export async function issueAccessToken(
  db: D1Database,
  userId: string,
  ttlSeconds: number,
  grantId: string,
): Promise<{ id: string; token: string; expiresAt: string }> {
  const now = nowIso();
  await db
    .prepare(`UPDATE access_tokens SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL`)
    .bind(now, grantId)
    .run();
  const active = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM access_tokens
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
    )
    .bind(userId, now)
    .first<{ n: number }>();
  if ((active?.n ?? 0) >= 20) {
    throw new Error("too_many_tokens");
  }
  const token = `mb_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const id = crypto.randomUUID();
  const expiresAt = addSeconds(ttlSeconds);
  await db
    .prepare(
      `INSERT INTO access_tokens (id, user_id, token_hash, expires_at, created_at, grant_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, await sha256Hex(token), expiresAt, now, grantId)
    .run();
  return { id, token, expiresAt };
}

export async function userForAccessToken(
  db: D1Database,
  rawToken: string,
): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT users.* FROM access_tokens
       JOIN users ON users.id = access_tokens.user_id
       WHERE access_tokens.token_hash = ?
         AND access_tokens.revoked_at IS NULL
         AND access_tokens.expires_at > ?
         AND access_tokens.grant_id IS NOT NULL`,
    )
    .bind(await sha256Hex(rawToken), nowIso())
    .first<UserRow>();
}

// GrantRef is the OAuth grant behind a bearer token: the grant id (the
// unit folder scoping is enforced on) and the OAuth client's registered
// name (the unit app attribution is derived from).
export interface GrantRef {
  id: string;
  clientId: string;
  name: string;
}

// grantForAccessToken resolves a bearer token to its OAuth grant. Returns
// null when the token has no grant (defensive: issueAccessToken always
// sets one today).
export async function grantForAccessToken(
  db: D1Database,
  rawToken: string,
): Promise<GrantRef | null> {
  const row = await db
    .prepare(
      `SELECT g.id, g.client_id, c.name
       FROM access_tokens a
       JOIN oauth_grants g ON g.id = a.grant_id
       JOIN oauth_clients c ON c.id = g.client_id
       WHERE a.token_hash = ?
         AND a.revoked_at IS NULL
         AND a.expires_at > ?
         AND a.grant_id IS NOT NULL`,
    )
    .bind(await sha256Hex(rawToken), nowIso())
    .first<{ id: string; client_id: string; name: string }>();
  if (!row) {
    return null;
  }
  return { id: row.id, clientId: row.client_id, name: row.name };
}

export async function rememberNonce(db: D1Database, nonce: string): Promise<boolean> {
  const ts = nowIso();
  await db.prepare("DELETE FROM auth_nonces WHERE expires_at < ?").bind(ts).run();
  try {
    await db
      .prepare("INSERT INTO auth_nonces (nonce, expires_at) VALUES (?, ?)")
      .bind(nonce, addSeconds(10 * 60))
      .run();
    return true;
  } catch {
    return false;
  }
}

export function pairingCode(): string {
  let out = "";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) {
    out += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length];
  }
  return formatPairingCode(out);
}

export async function savePairingCode(
  db: D1Database,
  deviceId: string,
  code: string,
): Promise<string> {
  const normalized = normalizePairingCode(code);
  if (!normalized) {
    throw new Error("code");
  }
  const expires = addSeconds(10 * 60);
  await db
    .prepare("DELETE FROM pairing_codes WHERE device_id = ? AND consumed_at IS NULL")
    .bind(deviceId)
    .run();
  await db
    .prepare(
      `INSERT INTO pairing_codes (code_hash, device_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
    )
    .bind(await sha256Hex(normalized), deviceId, expires, nowIso())
    .run();
  return expires;
}

export async function getDevice(db: D1Database, id: string): Promise<DeviceRecord | null> {
  return db.prepare("SELECT * FROM devices WHERE id = ?").bind(id).first<DeviceRecord>();
}

export async function deviceByPublicKey(
  db: D1Database,
  publicKey: string,
): Promise<DeviceRecord | null> {
  return db
    .prepare("SELECT * FROM devices WHERE public_key = ?")
    .bind(publicKey)
    .first<DeviceRecord>();
}

export async function insertDevice(
  db: D1Database,
  device: {
    id: string;
    publicKey: string;
    name: string;
    os?: string;
    arch?: string;
    clientIp?: string;
    clientRegion?: string;
  },
): Promise<void> {
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO devices
        (id, public_key, name, status, os, arch, client_ip, client_region, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      device.id,
      device.publicKey,
      device.name,
      device.os ?? "",
      device.arch ?? "",
      device.clientIp ?? "",
      device.clientRegion ?? "",
      ts,
      ts,
    )
    .run();
}

export async function touchDeviceMeta(
  db: D1Database,
  id: string,
  meta: { name: string; os: string; arch: string; clientIp: string; clientRegion: string },
): Promise<void> {
  await db
    .prepare(
      `UPDATE devices
       SET name = ?, os = ?, arch = ?, client_ip = ?, client_region = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(meta.name, meta.os, meta.arch, meta.clientIp, meta.clientRegion, nowIso(), id)
    .run();
}

export async function pairFailureCount(
  db: D1Database,
  bucket: string,
  windowSeconds: number,
): Promise<number> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM pair_attempts WHERE bucket = ? AND created_at > ?")
    .bind(bucket, since)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function notePairFailure(db: D1Database, bucket: string): Promise<void> {
  await db
    .prepare("INSERT INTO pair_attempts (bucket, created_at) VALUES (?, ?)")
    .bind(bucket, nowIso())
    .run();
}

export async function listDevicesForUser(db: D1Database, userId: string): Promise<DeviceRecord[]> {
  const result = await db
    .prepare("SELECT * FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC")
    .bind(userId)
    .all<DeviceRecord>();
  return result.results;
}

export async function setDeviceStatus(
  db: D1Database,
  id: string,
  status: string,
  userId: string | null,
): Promise<void> {
  const ts = nowIso();
  if (status === "active" && userId) {
    await db
      .prepare(
        `UPDATE devices SET status = 'active', user_id = ?, paired_at = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(userId, ts, ts, id)
      .run();
    return;
  }
  await db
    .prepare("UPDATE devices SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, ts, id)
    .run();
}

export async function setDeviceVersion(db: D1Database, id: string, version: string): Promise<void> {
  await db
    .prepare(`UPDATE devices SET client_version = ? WHERE id = ?`)
    .bind(version.slice(0, 32), id)
    .run();
}

export async function touchDevice(db: D1Database, id: string): Promise<void> {
  const ts = nowIso();
  await db
    .prepare("UPDATE devices SET last_seen_at = ?, updated_at = ? WHERE id = ?")
    .bind(ts, ts, id)
    .run();
}

export type CodeLookup =
  | { status: "ok"; device_id: string; expires_at: string }
  | { status: "expired" }
  | { status: "invalid" };

async function findPairingCode(db: D1Database, code: string): Promise<CodeLookup> {
  const normalized = normalizePairingCode(code);
  if (!normalized) {
    return { status: "invalid" };
  }
  const row = await db
    .prepare(`SELECT device_id, consumed_at, expires_at FROM pairing_codes WHERE code_hash = ?`)
    .bind(await sha256Hex(normalized))
    .first<{ device_id: string; consumed_at: string | null; expires_at: string }>();
  if (!row || row.consumed_at) {
    return { status: "invalid" };
  }
  if (row.expires_at <= nowIso()) {
    return { status: "expired" };
  }
  return { status: "ok", device_id: row.device_id, expires_at: row.expires_at };
}

export async function lookupPairingCode(db: D1Database, code: string): Promise<CodeLookup> {
  return findPairingCode(db, code);
}

export async function consumePairingCode(db: D1Database, code: string): Promise<CodeLookup> {
  const found = await findPairingCode(db, code);
  if (found.status !== "ok") {
    return found;
  }
  const normalized = normalizePairingCode(code);
  if (!normalized) {
    return { status: "invalid" };
  }
  const result = await db
    .prepare("UPDATE pairing_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL")
    .bind(nowIso(), await sha256Hex(normalized))
    .run();
  if ((result.meta.changes ?? 0) < 1) {
    return { status: "invalid" };
  }
  return found;
}

// folderScopeClause restricts a folder query to what one grant may see.
// A folder with no folder_apps rows is unrestricted; a folder with rows
// is visible only to a listed grant. The grant id is bound as a
// parameter, never interpolated.
function folderScopeClause(grantId: string | null): { clause: string; binds: string[] } {
  if (grantId === null) {
    // Unknown app: it cannot prove membership in any restricted set, so
    // it sees unrestricted folders only.
    return {
      clause: "AND NOT EXISTS (SELECT 1 FROM folder_apps WHERE folder_apps.folder_id = folders.id)",
      binds: [],
    };
  }
  return {
    clause:
      "AND (NOT EXISTS (SELECT 1 FROM folder_apps WHERE folder_apps.folder_id = folders.id) " +
      "OR EXISTS (SELECT 1 FROM folder_apps WHERE folder_apps.folder_id = folders.id AND folder_apps.grant_id = ?))",
    binds: [grantId],
  };
}

export async function listFolders(
  db: D1Database,
  deviceId: string,
  // grantId scopes the result to what one app may see. Undefined means
  // the caller is not an MCP app (the dashboard manages scoping itself
  // and sees everything); null means the app is unknown, so only
  // unrestricted folders are returned.
  grantId?: string | null,
): Promise<FolderRow[]> {
  const scope = grantId === undefined ? { clause: "", binds: [] } : folderScopeClause(grantId);
  const result = await db
    .prepare(
      `SELECT id, device_id, label, approval, listed FROM folders
       WHERE device_id = ? AND listed = 1 ${scope.clause} ORDER BY label`,
    )
    .bind(deviceId, ...scope.binds)
    .all<FolderRow>();
  return result.results;
}

export async function listFoldersForUser(
  db: D1Database,
  userId: string,
  // See listFolders: undefined is the dashboard (unfiltered), null is an
  // unknown app (unrestricted folders only), a grant id is that app.
  grantId?: string | null,
): Promise<Array<FolderRow & { device_name: string }>> {
  const scope = grantId === undefined ? { clause: "", binds: [] } : folderScopeClause(grantId);
  const result = await db
    .prepare(
      `SELECT folders.id, folders.device_id, folders.label, folders.approval, folders.listed, devices.name AS device_name
       FROM folders JOIN devices ON devices.id = folders.device_id
       WHERE devices.user_id = ? AND folders.listed = 1 ${scope.clause}
       ORDER BY devices.name, folders.label`,
    )
    .bind(userId, ...scope.binds)
    .all<FolderRow & { device_name: string }>();
  return result.results;
}

// folderApps returns, for each folder id given, the grant ids allowed to
// see it. A folder absent from the map is unrestricted.
export async function folderApps(
  db: D1Database,
  folderIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (folderIds.length === 0) {
    return map;
  }
  const placeholders = folderIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT folder_id, grant_id FROM folder_apps WHERE folder_id IN (${placeholders}) ORDER BY folder_id, grant_id`,
    )
    .bind(...folderIds)
    .all<{ folder_id: string; grant_id: string }>();
  for (const row of result.results) {
    const list = map.get(row.folder_id) ?? [];
    list.push(row.grant_id);
    map.set(row.folder_id, list);
  }
  return map;
}

export type SetFolderAppsResult = { ok: true } | { ok: false; reason: "not_found" | "unknown_app" };

// setFolderApps replaces the allowed-apps list for one folder. grantIds
// null means unrestricted (no rows). An empty array means no app may see
// the folder. Every grant id must belong to the user and not be revoked;
// a foreign grant id fails the whole update and nothing is written.
export async function setFolderApps(
  db: D1Database,
  userId: string,
  folderId: string,
  grantIds: string[] | null,
): Promise<SetFolderAppsResult> {
  const folder = await db
    .prepare(
      `SELECT folders.id FROM folders
       JOIN devices ON devices.id = folders.device_id
       WHERE folders.id = ? AND devices.user_id = ?`,
    )
    .bind(folderId, userId)
    .first();
  if (!folder) {
    return { ok: false, reason: "not_found" };
  }
  const grants = grantIds ?? [];
  for (const grantId of grants) {
    const grant = await db
      .prepare(`SELECT id FROM oauth_grants WHERE id = ? AND user_id = ? AND revoked_at IS NULL`)
      .bind(grantId, userId)
      .first();
    if (!grant) {
      return { ok: false, reason: "unknown_app" };
    }
  }
  const statements = [db.prepare("DELETE FROM folder_apps WHERE folder_id = ?").bind(folderId)];
  for (const grantId of grants) {
    statements.push(
      db
        .prepare("INSERT INTO folder_apps (folder_id, grant_id, created_at) VALUES (?, ?, ?)")
        .bind(folderId, grantId, nowIso()),
    );
  }
  await db.batch(statements);
  return { ok: true };
}

export async function rememberPickedFolder(
  db: D1Database,
  deviceId: string,
  id: string,
  label: string,
): Promise<void> {
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO folders (id, device_id, label, approval, listed, created_at, updated_at)
       VALUES (?, ?, ?, 'approved', 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label,
         listed = 1,
         approval = 'approved',
         updated_at = excluded.updated_at`,
    )
    .bind(id, deviceId, label, ts, ts)
    .run();
}

export async function renameUserFolder(
  db: D1Database,
  userId: string,
  folderId: string,
  label: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE folders SET label = ?, updated_at = ?
       WHERE id = ? AND device_id IN (SELECT id FROM devices WHERE user_id = ?)`,
    )
    .bind(label, nowIso(), folderId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function unlistUserFolder(
  db: D1Database,
  userId: string,
  folderId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE folders SET listed = 0, updated_at = ?
       WHERE id = ? AND device_id IN (SELECT id FROM devices WHERE user_id = ?)`,
    )
    .bind(nowIso(), folderId, userId)
    .run();
  const changed = (result.meta.changes ?? 0) > 0;
  if (changed) {
    // Removing a folder drops its per-app scoping with it, so a later
    // re-add does not silently resurrect an old restriction.
    await db.prepare("DELETE FROM folder_apps WHERE folder_id = ?").bind(folderId).run();
  }
  return changed;
}

export async function setFolderApproval(
  db: D1Database,
  userId: string,
  folderId: string,
  approval: "approved" | "revoked",
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE folders SET approval = ?, updated_at = ?
       WHERE id = ? AND listed = 1 AND device_id IN (SELECT id FROM devices WHERE user_id = ?)`,
    )
    .bind(approval, nowIso(), folderId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function syncFolders(
  db: D1Database,
  deviceId: string,
  folders: Array<{ id: string; label: string }>,
): Promise<string[]> {
  for (const folder of folders) {
    const existing = await db
      .prepare("SELECT device_id FROM folders WHERE id = ?")
      .bind(folder.id)
      .first<{ device_id: string }>();
    if (existing && existing.device_id !== deviceId) {
      throw new Error("folder belongs to another device");
    }
  }
  const ts = nowIso();
  const statements = [
    db
      .prepare("UPDATE folders SET listed = 0, updated_at = ? WHERE device_id = ?")
      .bind(ts, deviceId),
  ];
  for (const folder of folders) {
    statements.push(
      db
        .prepare(
          `INSERT INTO folders (id, device_id, label, approval, listed, created_at, updated_at)
           VALUES (?, ?, ?, 'pending', 1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             label = excluded.label,
             listed = 1,
             updated_at = excluded.updated_at`,
        )
        .bind(folder.id, deviceId, folder.label, ts, ts),
    );
  }
  await db.batch(statements);
  const approved = await db
    .prepare(`SELECT id FROM folders WHERE device_id = ? AND listed = 1 AND approval = 'approved'`)
    .bind(deviceId)
    .all<{ id: string }>();
  return approved.results.map((row) => row.id);
}

export interface ActivityRow {
  id: string;
  user_id: string;
  device_id: string | null;
  client: string;
  op: string;
  folder: string | null;
  path: string | null;
  ok: number;
  error_code: string | null;
  created_at: string;
}

// logActivity records one tool call in the audit log. Only metadata is
// stored: the operation, folder label and path. File contents are never
// stored. A logging failure is the caller's problem to swallow, so this
// throws and the caller decides.
export async function logActivity(
  db: D1Database,
  entry: {
    userId: string;
    deviceId: string | null;
    client: string;
    op: string;
    folder: string | null;
    path: string | null;
    ok: boolean;
    errorCode: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO activity (id, user_id, device_id, client, op, folder, path, ok, error_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      entry.userId,
      entry.deviceId,
      entry.client,
      entry.op,
      entry.folder,
      entry.path,
      entry.ok ? 1 : 0,
      entry.errorCode,
      nowIso(),
    )
    .run();
}

// listActivity returns the newest audit rows for a user and prunes rows older
// than 30 days on the same trip, so no scheduled job is needed to enforce
// retention.
export async function listActivity(
  db: D1Database,
  userId: string,
  limit = 100,
): Promise<ActivityRow[]> {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  await db.prepare("DELETE FROM activity WHERE created_at < ?").bind(cutoff).run();
  const result = await db
    .prepare(
      `SELECT id, user_id, device_id, client, op, folder, path, ok, error_code, created_at
       FROM activity WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(userId, Math.min(Math.max(limit, 1), 100))
    .all<ActivityRow>();
  return result.results;
}

export interface ApprovalRow {
  id: string;
  user_id: string;
  device_id: string;
  grant_id: string | null;
  client: string;
  tool: string;
  folder_id: string;
  folder_label: string;
  path: string;
  op: string;
  content_hash: string;
  pre_hash: string;
  diff: string;
  preview: string;
  argv: string;
  size: number;
  status: string;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  executed_at: string | null;
}

// createApproval records a dashboard approval request the bridge just
// returned as approval_required. The row is transport + record-keeping:
// the bridge holds the token and the hashes, and the dashboard reads
// this row to show the diff. The diff/preview come from the bridge, so
// what the user reviews is what the bridge computed from the exact bytes.
export async function createApproval(
  db: D1Database,
  row: {
    id: string;
    userId: string;
    deviceId: string;
    grantId: string | null;
    client: string;
    tool: string;
    folderId: string;
    folderLabel: string;
    path: string;
    op: string;
    contentHash: string;
    preHash: string;
    diff: string;
    preview: string;
    argv: string[];
    size: number;
    expiresInSeconds: number;
  },
): Promise<void> {
  const now = new Date();
  await db
    .prepare(
      `INSERT INTO approvals
       (id, user_id, device_id, grant_id, client, tool, folder_id, folder_label, path, op,
        content_hash, pre_hash, diff, preview, argv, size, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      row.id,
      row.userId,
      row.deviceId,
      row.grantId,
      row.client,
      row.tool,
      row.folderId,
      row.folderLabel,
      row.path,
      row.op,
      row.contentHash,
      row.preHash,
      row.diff,
      row.preview,
      JSON.stringify(row.argv),
      row.size,
      now.toISOString(),
      new Date(now.getTime() + row.expiresInSeconds * 1000).toISOString(),
    )
    .run();
}

// pruneApprovals marks pending requests past their expiry as expired, so
// a stale request can never be approved from the dashboard.
export async function pruneApprovals(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE approvals SET status = 'expired'
       WHERE user_id = ? AND status = 'pending' AND expires_at <= ?`,
    )
    .bind(userId, nowIso())
    .run();
}

// listApprovals returns the newest approval requests for a user, pending
// first. Expired pending rows are marked on the same trip.
export async function listApprovals(
  db: D1Database,
  userId: string,
  limit = 50,
): Promise<ApprovalRow[]> {
  await pruneApprovals(db, userId);
  const result = await db
    .prepare(
      `SELECT * FROM approvals WHERE user_id = ?
       ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT ?`,
    )
    .bind(userId, Math.min(Math.max(limit, 1), 100))
    .all<ApprovalRow>();
  return result.results;
}

export async function getApproval(
  db: D1Database,
  userId: string,
  id: string,
): Promise<ApprovalRow | null> {
  const row = await db
    .prepare("SELECT * FROM approvals WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<ApprovalRow>();
  return row ?? null;
}

// setApprovalStatus moves a pending request to its decided state. It
// only touches pending rows: a request that is already approved, denied,
// expired, or executed stays as it is, so a late second call cannot
// resurrect it. Returns false when the row was not pending.
export async function setApprovalStatus(
  db: D1Database,
  userId: string,
  id: string,
  status: "approved" | "denied" | "expired" | "executed" | "failed",
): Promise<boolean> {
  const now = nowIso();
  const result = await db
    .prepare(
      `UPDATE approvals
       SET status = ?, decided_at = ?, executed_at = CASE WHEN ? = 'executed' THEN ? ELSE executed_at END
       WHERE id = ? AND user_id = ? AND status = 'pending'`,
    )
    .bind(status, now, status, now, id, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

// getSetting reads one per-user setting by key, or null when it was
// never set.
export async function getSetting(
  db: D1Database,
  userId: string,
  key: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE user_id = ? AND key = ?")
    .bind(userId, key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(
  db: D1Database,
  userId: string,
  key: string,
  value: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(userId, key, value, nowIso())
    .run();
}

export type WriteApprovalMode = "ai" | "manual";

// getWriteApprovalMode returns the user's write approval mode. The
// default is "ai": the connected app's own confirmation card is the gate
// for normal writes, and dashboard pre-approval applies only to
// high-risk ops (delete, exec, executable files). "manual" means every
// write and exec needs the user's manual approval in the dashboard.
export async function getWriteApprovalMode(
  db: D1Database,
  userId: string,
): Promise<WriteApprovalMode> {
  const value = await getSetting(db, userId, "write_approval_mode");
  return value === "manual" ? "manual" : "ai";
}

export async function setWriteApprovalMode(
  db: D1Database,
  userId: string,
  mode: WriteApprovalMode,
): Promise<void> {
  await setSetting(db, userId, "write_approval_mode", mode);
}

export async function createMcpSession(
  db: D1Database,
  userId: string,
  protocol: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO mcp_sessions (id, user_id, protocol_version, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, protocol, nowIso(), addSeconds(24 * 3600))
    .run();
  return id;
}

export async function mcpSessionValid(
  db: D1Database,
  id: string,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM mcp_sessions WHERE id = ? AND user_id = ? AND expires_at > ?")
    .bind(id, userId, nowIso())
    .first();
  return Boolean(row);
}

export async function deleteMcpSession(db: D1Database, id: string, userId: string): Promise<void> {
  await db.prepare("DELETE FROM mcp_sessions WHERE id = ? AND user_id = ?").bind(id, userId).run();
}

export async function saveLoginState(db: D1Database, state: string): Promise<void> {
  await db
    .prepare("INSERT INTO login_states (state, expires_at, created_at) VALUES (?, ?, ?)")
    .bind(state, addSeconds(10 * 60), nowIso())
    .run();
}

export async function takeLoginState(db: D1Database, state: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT state FROM login_states WHERE state = ? AND expires_at > ?")
    .bind(state, nowIso())
    .first();
  if (!row) {
    return false;
  }
  await db.prepare("DELETE FROM login_states WHERE state = ?").bind(state).run();
  return true;
}
