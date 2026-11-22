export interface DeviceRow {
  id: string;
  user_id: string | null;
  status: string;
  last_seen_at: string | null;
  name: string;
}

export interface FolderRow {
  id: string;
  device_id: string;
  label: string;
  approval: string;
  listed: number;
}

export interface ToolError {
  code: string;
  message: string;
}

// chooseDevice picks one of the caller's own connected devices.
// It has no parameter for a client-supplied device id: routing comes from the authenticated user.
export function chooseDevice(
  userId: string,
  devices: DeviceRow[],
  connected: ReadonlySet<string>,
): DeviceRow | null {
  const eligible = devices.filter(
    (device) => device.user_id === userId && device.status === "active" && connected.has(device.id),
  );
  eligible.sort((a, b) => (b.last_seen_at ?? "").localeCompare(a.last_seen_at ?? ""));
  return eligible[0] ?? null;
}

export function resolveFolder(
  folders: FolderRow[],
  label: string,
): { ok: true; folder: FolderRow } | { ok: false; error: ToolError } {
  const name = label.trim();
  if (!name || name.length > 41 || name.includes("/") || name.includes("\\")) {
    return { ok: false, error: { code: "bad_request", message: "The folder label is not valid." } };
  }
  const matches = folders.filter((folder) => folder.listed === 1 && folder.label === name);
  if (matches.length === 0) {
    return { ok: false, error: { code: "not_found", message: "Unknown folder." } };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: { code: "bad_request", message: "That folder label is ambiguous." },
    };
  }
  const folder = matches[0];
  if (!folder) {
    return { ok: false, error: { code: "not_found", message: "Unknown folder." } };
  }
  if (folder.approval !== "approved") {
    return { ok: false, error: { code: "not_approved", message: "That folder is not approved." } };
  }
  return { ok: true, folder };
}
