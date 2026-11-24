import { describe, expect, it } from "vitest";
import {
  createApproval,
  folderApps,
  getApproval,
  getWriteApprovalMode,
  listApprovals,
  listFolders,
  listFoldersForUser,
  setApprovalStatus,
  setFolderApps,
  setWriteApprovalMode,
  unlistUserFolder,
} from "./db.ts";

interface RecordedStatement {
  sql: string;
  args: unknown[];
}

interface FakeHandlers {
  all?: (sql: string, args: unknown[]) => unknown[];
  first?: (sql: string, args: unknown[]) => unknown | null;
  changes?: number;
}

// A minimal stand-in for D1Database: it records every statement and
// answers all/first/run from handlers the test provides. Only the surface
// db.ts uses is implemented.
function fakeDb(handlers: FakeHandlers = {}): {
  db: D1Database;
  statements: RecordedStatement[];
  batched: number;
} {
  const statements: RecordedStatement[] = [];
  let batched = 0;
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        statements.push({ sql, args });
        return {
          all: async <T>(): Promise<{ results: T[] }> => ({
            results: (handlers.all?.(sql, args) ?? []) as T[],
          }),
          first: async <T>(): Promise<T | null> => {
            const row = handlers.first?.(sql, args) ?? null;
            return row as T | null;
          },
          run: async (): Promise<{ meta: { changes: number } }> => ({
            meta: { changes: handlers.changes ?? 1 },
          }),
        };
      },
    }),
    batch: async (stmts: unknown[]) => {
      batched += stmts.length;
    },
  } as unknown as D1Database;
  return {
    db,
    statements,
    get batched() {
      return batched;
    },
  };
}

describe("folder scoping", () => {
  it("lists everything for the dashboard (no grant)", async () => {
    const { db, statements } = fakeDb({
      all: () => [{ id: "f1", label: "notes" }],
    });
    const folders = await listFoldersForUser(db, "user-1");
    expect(folders).toHaveLength(1);
    const stmt = statements.at(0);
    expect(stmt?.sql).not.toContain("folder_apps");
    expect(stmt?.args).toEqual(["user-1"]);
  });

  it("scopes the folder list to one grant", async () => {
    const { db, statements } = fakeDb({ all: () => [] });
    await listFoldersForUser(db, "user-1", "grant-1");
    const stmt = statements.at(0);
    expect(stmt?.sql).toContain("folder_apps");
    expect(stmt?.sql).toContain("grant_id = ?");
    expect(stmt?.args).toEqual(["user-1", "grant-1"]);
  });

  it("shows an unknown app only unrestricted folders", async () => {
    const { db, statements } = fakeDb({ all: () => [] });
    await listFolders(db, "device-1", null);
    const stmt = statements.at(0);
    expect(stmt?.sql).toContain("NOT EXISTS (SELECT 1 FROM folder_apps");
    expect(stmt?.sql).not.toContain("grant_id = ?");
    expect(stmt?.args).toEqual(["device-1"]);
  });

  it("scopes the per-device list the same way", async () => {
    const { db, statements } = fakeDb({ all: () => [] });
    await listFolders(db, "device-1", "grant-1");
    expect(statements.at(0)?.args).toEqual(["device-1", "grant-1"]);
  });

  it("reads the allowed-apps map for folders", async () => {
    const { db, statements } = fakeDb({
      all: () => [
        { folder_id: "f1", grant_id: "g1" },
        { folder_id: "f1", grant_id: "g2" },
      ],
    });
    const map = await folderApps(db, ["f1", "f2"]);
    expect(map.get("f1")).toEqual(["g1", "g2"]);
    expect(map.has("f2")).toBe(false);
    expect(statements.at(0)?.sql).toContain("IN (?, ?)");
    expect(statements.at(0)?.args).toEqual(["f1", "f2"]);
  });

  it("does not query for an empty folder list", async () => {
    const { db, statements } = fakeDb();
    expect((await folderApps(db, [])).size).toBe(0);
    expect(statements).toHaveLength(0);
  });
});

describe("setFolderApps", () => {
  const folderAndGrants = (knownGrants: string[]) => ({
    first: (sql: string, args: unknown[]) => {
      if (sql.includes("FROM folders")) {
        return { id: "f1" };
      }
      if (sql.includes("FROM oauth_grants")) {
        const grantId = args.at(0);
        return typeof grantId === "string" && knownGrants.includes(grantId)
          ? { id: grantId }
          : null;
      }
      return null;
    },
  });

  it("replaces the list with one delete plus one insert per grant", async () => {
    const fake = fakeDb(folderAndGrants(["g1", "g2"]));
    const { db, statements } = fake;
    expect(await setFolderApps(db, "user-1", "f1", ["g1", "g2"])).toEqual({ ok: true });
    expect(fake.batched).toBe(3);
    const writes = statements.filter(
      (stmt) => stmt.sql.startsWith("DELETE") || stmt.sql.startsWith("INSERT"),
    );
    expect(writes).toHaveLength(3);
    expect(writes.at(0)?.sql).toContain("DELETE FROM folder_apps");
    // INSERT binds (folder_id, grant_id, created_at).
    expect(writes.at(1)?.args.slice(0, 2)).toEqual(["f1", "g1"]);
    expect(writes.at(2)?.args.slice(0, 2)).toEqual(["f1", "g2"]);
  });

  it("clears the list for null (unrestricted)", async () => {
    const fake = fakeDb(folderAndGrants([]));
    expect(await setFolderApps(fake.db, "user-1", "f1", null)).toEqual({ ok: true });
    expect(fake.batched).toBe(1);
  });

  it("refuses a folder that is not the user's", async () => {
    const fake = fakeDb({
      first: (sql) => (sql.includes("FROM folders") ? null : { id: "g1" }),
    });
    expect(await setFolderApps(fake.db, "user-1", "f1", ["g1"])).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(fake.batched).toBe(0);
  });

  it("refuses a grant that is not the user's and writes nothing", async () => {
    const fake = fakeDb(folderAndGrants(["g1"]));
    expect(await setFolderApps(fake.db, "user-1", "f1", ["g1", "g2"])).toEqual({
      ok: false,
      reason: "unknown_app",
    });
    expect(fake.batched).toBe(0);
  });
});

describe("unlistUserFolder", () => {
  it("drops the scoping rows when a folder is removed", async () => {
    const { db, statements } = fakeDb({ changes: 1 });
    expect(await unlistUserFolder(db, "user-1", "f1")).toBe(true);
    expect(
      statements.some((stmt) => stmt.sql === "DELETE FROM folder_apps WHERE folder_id = ?"),
    ).toBe(true);
  });

  it("leaves scoping alone when the folder was not found", async () => {
    const { db, statements } = fakeDb({ changes: 0 });
    expect(await unlistUserFolder(db, "user-1", "f1")).toBe(false);
    expect(statements.some((stmt) => stmt.sql.startsWith("DELETE FROM folder_apps"))).toBe(false);
  });
});

describe("approvals", () => {
  const row = {
    id: "req-1",
    userId: "user-1",
    deviceId: "dev-1",
    grantId: "grant-1",
    client: "chatgpt",
    tool: "write_file",
    folderId: "f1",
    folderLabel: "notes",
    path: "a.md",
    op: "write_file",
    contentHash: "content-hash",
    preHash: "pre-hash",
    diff: "+hello",
    preview: "",
    argv: [] as string[],
    size: -1,
    expiresInSeconds: 86_400,
  };

  it("creates a row with the bridge's evidence", async () => {
    const { db, statements } = fakeDb();
    await createApproval(db, row);
    const stmt = statements.at(0);
    expect(stmt?.sql).toContain("INSERT INTO approvals");
    expect(stmt?.sql).toContain("ON CONFLICT(id) DO NOTHING");
    expect(stmt?.args[0]).toBe("req-1");
    expect(stmt?.args[1]).toBe("user-1");
    expect(stmt?.args[14]).toBe("[]");
    expect(stmt?.args[15]).toBe(-1);
  });

  it("lists pending first and prunes expired rows on the same trip", async () => {
    const { db, statements } = fakeDb({ all: () => [] });
    const rows = await listApprovals(db, "user-1");
    expect(rows).toEqual([]);
    expect(statements[0]?.sql).toContain("status = 'expired'");
    expect(statements[1]?.sql).toContain("ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END");
    expect(statements[1]?.args).toEqual(["user-1", 50]);
  });

  it("reads one approval by id", async () => {
    const found = { id: "req-1", status: "pending" };
    const { db } = fakeDb({ first: () => found });
    expect(await getApproval(db, "user-1", "req-1")).toEqual(found);
    const missing = fakeDb({ first: () => null });
    expect(await getApproval(missing.db, "user-1", "nope")).toBeNull();
  });

  it("only moves pending rows", async () => {
    const { db, statements } = fakeDb({ changes: 1 });
    expect(await setApprovalStatus(db, "user-1", "req-1", "approved")).toBe(true);
    expect(statements.at(0)?.sql).toContain("status = 'pending'");
    expect(statements.at(0)?.args).toContain("approved");
    const none = fakeDb({ changes: 0 });
    expect(await setApprovalStatus(none.db, "user-1", "req-1", "approved")).toBe(false);
  });
});

describe("write approval mode", () => {
  it("defaults to ai and round-trips manual", async () => {
    const unset = fakeDb({ first: () => null });
    expect(await getWriteApprovalMode(unset.db, "user-1")).toBe("ai");
    const manual = fakeDb({ first: () => ({ value: "manual" }) });
    expect(await getWriteApprovalMode(manual.db, "user-1")).toBe("manual");
    const other = fakeDb({ first: () => ({ value: "bogus" }) });
    expect(await getWriteApprovalMode(other.db, "user-1")).toBe("ai");
    const { db, statements } = fakeDb();
    await setWriteApprovalMode(db, "user-1", "manual");
    expect(statements.at(0)?.sql).toContain("INSERT INTO settings");
    expect(statements.at(0)?.args.slice(0, 3)).toEqual(["user-1", "write_approval_mode", "manual"]);
  });
});
