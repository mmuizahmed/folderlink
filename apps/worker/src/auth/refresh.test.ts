import { describe, expect, it } from "vitest";
import {
  issueRefreshToken,
  rotateRefreshToken,
  type RefreshRecord,
  type RefreshStore,
} from "./refresh.ts";

function memoryStore(): RefreshStore & { rows: RefreshRecord[] } {
  const rows: RefreshRecord[] = [];
  return {
    rows,
    async insert(record) {
      rows.push({ ...record });
    },
    async findByHash(hash) {
      return rows.find((row) => row.tokenHash === hash) ?? null;
    },
    async claim(id, replacedBy, at) {
      const row = rows.find((item) => item.id === id);
      if (!row || row.revokedAt) {
        return false;
      }
      row.revokedAt = at;
      row.replacedBy = replacedBy;
      return true;
    },
    async revokeFamily(familyId, at) {
      for (const row of rows) {
        if (row.familyId === familyId && !row.revokedAt) {
          row.revokedAt = at;
        }
      }
    },
  };
}

describe("refresh tokens", () => {
  it("rotates once and treats reuse of the old token as a family revocation", async () => {
    const store = memoryStore();
    const now = new Date("2026-11-22T00:00:00.000Z");
    const issued = await issueRefreshToken(store, "user-1", "family-1", now, 3600);
    const rotated = await rotateRefreshToken(store, issued.token, now, 3600);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) {
      return;
    }
    const reuse = await rotateRefreshToken(store, issued.token, now, 3600);
    expect(reuse).toEqual({ ok: false, reason: "reuse" });
    const after = await rotateRefreshToken(store, rotated.token, now, 3600);
    expect(after).toEqual({ ok: false, reason: "reuse" });
  });
});
