import { describe, expect, it } from "vitest";
import { chooseDevice, resolveFolder, type DeviceRow, type FolderRow } from "./routing.ts";

const devices: DeviceRow[] = [
  {
    id: "device-a",
    user_id: "user-1",
    status: "active",
    last_seen_at: "2026-11-22T00:00:00.000Z",
    name: "old",
  },
  {
    id: "device-b",
    user_id: "user-1",
    status: "active",
    last_seen_at: "2026-11-22T01:00:00.000Z",
    name: "new",
  },
  {
    id: "device-c",
    user_id: "user-2",
    status: "active",
    last_seen_at: "2026-11-22T02:00:00.000Z",
    name: "other",
  },
  {
    id: "device-d",
    user_id: "user-1",
    status: "revoked",
    last_seen_at: "2026-11-22T03:00:00.000Z",
    name: "revoked",
  },
];

describe("chooseDevice", () => {
  it("uses the caller's most recently seen connected device", () => {
    const chosen = chooseDevice("user-1", devices, new Set(["device-a", "device-b", "device-c"]));
    expect(chosen?.id).toBe("device-b");
  });

  it("does not select another person's device or a disconnected one", () => {
    expect(chooseDevice("user-1", devices, new Set(["device-c", "device-d"]))).toBeNull();
    expect(chooseDevice("user-2", devices, new Set(["device-b"]))).toBeNull();
  });
});

describe("resolveFolder", () => {
  const folders: FolderRow[] = [
    { id: "1", device_id: "device-b", label: "notes", approval: "approved", listed: 1 },
    { id: "2", device_id: "device-b", label: "labs", approval: "pending", listed: 1 },
    { id: "3", device_id: "device-b", label: "old", approval: "approved", listed: 0 },
  ];

  it("returns an approved folder and refuses a pending one", () => {
    expect(resolveFolder(folders, "notes").ok).toBe(true);
    const pending = resolveFolder(folders, "labs");
    expect(pending.ok).toBe(false);
    if (!pending.ok) {
      expect(pending.error.code).toBe("not_approved");
    }
    expect(resolveFolder(folders, "old").ok).toBe(false);
  });
});
