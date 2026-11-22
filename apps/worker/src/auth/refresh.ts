import { randomToken, sha256Hex } from "../crypto.ts";

export interface RefreshRecord {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  replacedBy: string | null;
}

export interface RefreshStore {
  insert(record: RefreshRecord): Promise<void>;
  findByHash(hash: string): Promise<RefreshRecord | null>;
  claim(id: string, replacedBy: string, at: string): Promise<boolean>;
  revokeFamily(familyId: string, at: string): Promise<void>;
}

export async function issueRefreshToken(
  store: RefreshStore,
  userId: string,
  familyId: string,
  now: Date,
  ttlSeconds: number,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken("mbr_");
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  await store.insert({
    id: crypto.randomUUID(),
    userId,
    familyId,
    tokenHash: await sha256Hex(token),
    expiresAt,
    revokedAt: null,
    replacedBy: null,
  });
  return { token, expiresAt };
}

export async function rotateRefreshToken(
  store: RefreshStore,
  raw: string,
  now: Date,
  ttlSeconds: number,
): Promise<
  | { ok: true; userId: string; token: string; expiresAt: string }
  | { ok: false; reason: "unknown" | "expired" | "reuse" }
> {
  const record = await store.findByHash(await sha256Hex(raw));
  if (!record) {
    return { ok: false, reason: "unknown" };
  }
  if (record.revokedAt || record.replacedBy) {
    await store.revokeFamily(record.familyId, now.toISOString());
    return { ok: false, reason: "reuse" };
  }
  if (record.expiresAt <= now.toISOString()) {
    return { ok: false, reason: "expired" };
  }
  const next = await issueRefreshToken(store, record.userId, record.familyId, now, ttlSeconds);
  const won = await store.claim(record.id, "rotated", now.toISOString());
  if (!won) {
    await store.revokeFamily(record.familyId, now.toISOString());
    return { ok: false, reason: "reuse" };
  }
  return { ok: true, userId: record.userId, token: next.token, expiresAt: next.expiresAt };
}

export function createD1RefreshStore(db: D1Database): RefreshStore {
  return {
    async insert(record) {
      await db
        .prepare(
          `INSERT INTO refresh_tokens
            (id, user_id, family_id, token_hash, expires_at, created_at, revoked_at, replaced_by)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
        )
        .bind(
          record.id,
          record.userId,
          record.familyId,
          record.tokenHash,
          record.expiresAt,
          new Date().toISOString(),
        )
        .run();
    },
    async findByHash(hash) {
      const row = await db
        .prepare(
          `SELECT id, user_id, family_id, token_hash, expires_at, revoked_at, replaced_by
           FROM refresh_tokens WHERE token_hash = ?`,
        )
        .bind(hash)
        .first<{
          id: string;
          user_id: string;
          family_id: string;
          token_hash: string;
          expires_at: string;
          revoked_at: string | null;
          replaced_by: string | null;
        }>();
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        userId: row.user_id,
        familyId: row.family_id,
        tokenHash: row.token_hash,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        replacedBy: row.replaced_by,
      };
    },
    async claim(id, replacedBy, at) {
      const result = await db
        .prepare(
          `UPDATE refresh_tokens SET revoked_at = ?, replaced_by = ?
           WHERE id = ? AND revoked_at IS NULL`,
        )
        .bind(at, replacedBy, id)
        .run();
      return (result.meta.changes ?? 0) > 0;
    },
    async revokeFamily(familyId, at) {
      await db
        .prepare(
          `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id = ?`,
        )
        .bind(at, familyId)
        .run();
    },
  };
}
