import { PAIRING_ALPHABET, formatPairingCode, normalizePairingCode } from "@mcp-bridge/shared";
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

export async function ensureDevUser(db: D1Database): Promise<UserRow> {
  const existing = await db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind("dev@localhost")
    .first<UserRow>();
  if (existing) {
    return existing;
  }
  const ts = nowIso();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO users (id, email, name, avatar_url, status, created_at, updated_at)
       VALUES (?, 'dev@localhost', 'Local dev', '', 'active', ?, ?)`,
    )
    .bind(id, ts, ts)
    .run();
  const created = await getUser(db, id);
  if (!created) {
    throw new Error("dev user was not created");
  }
  return created;
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
): Promise<{ id: string; token: string; expiresAt: string }> {
  const active = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM access_tokens
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
    )
    .bind(userId, nowIso())
    .first<{ n: number }>();
  if ((active?.n ?? 0) >= 20) {
    throw new Error("too_many_tokens");
  }
  const token = `mb_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const id = crypto.randomUUID();
  const expiresAt = addSeconds(ttlSeconds);
  await db
    .prepare(
      `INSERT INTO access_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, await sha256Hex(token), expiresAt, nowIso())
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
         AND access_tokens.expires_at > ?`,
    )
    .bind(await sha256Hex(rawToken), nowIso())
    .first<UserRow>();
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
  device: { id: string; publicKey: string; name: string },
): Promise<void> {
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO devices (id, public_key, name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(device.id, device.publicKey, device.name, ts, ts)
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

export async function touchDevice(db: D1Database, id: string): Promise<void> {
  const ts = nowIso();
  await db
    .prepare("UPDATE devices SET last_seen_at = ?, updated_at = ? WHERE id = ?")
    .bind(ts, ts, id)
    .run();
}

export async function consumePairingCode(
  db: D1Database,
  code: string,
): Promise<{ device_id: string } | null> {
  const normalized = normalizePairingCode(code);
  if (!normalized) {
    return null;
  }
  const row = await db
    .prepare(`SELECT device_id, consumed_at, expires_at FROM pairing_codes WHERE code_hash = ?`)
    .bind(await sha256Hex(normalized))
    .first<{ device_id: string; consumed_at: string | null; expires_at: string }>();
  if (!row || row.consumed_at || row.expires_at <= nowIso()) {
    return null;
  }
  await db
    .prepare("UPDATE pairing_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL")
    .bind(nowIso(), await sha256Hex(normalized))
    .run();
  return { device_id: row.device_id };
}

export async function listFolders(db: D1Database, deviceId: string): Promise<FolderRow[]> {
  const result = await db
    .prepare(
      `SELECT id, device_id, label, approval, listed FROM folders
       WHERE device_id = ? AND listed = 1 ORDER BY label`,
    )
    .bind(deviceId)
    .all<FolderRow>();
  return result.results;
}

export async function listFoldersForUser(
  db: D1Database,
  userId: string,
): Promise<Array<FolderRow & { device_name: string }>> {
  const result = await db
    .prepare(
      `SELECT folders.id, folders.device_id, folders.label, folders.approval, folders.listed, devices.name AS device_name
       FROM folders JOIN devices ON devices.id = folders.device_id
       WHERE devices.user_id = ? AND folders.listed = 1
       ORDER BY devices.name, folders.label`,
    )
    .bind(userId)
    .all<FolderRow & { device_name: string }>();
  return result.results;
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
