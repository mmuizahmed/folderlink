import type { ToolResult } from "@mcp-bridge/shared";
import type { InvokeRequest } from "../device/control.ts";
import type { Env } from "../env.ts";
import { listFolders, listFoldersForUser, logActivity } from "../db.ts";
import { chooseDevice, resolveFolder, type DeviceRow } from "../routing.ts";
import type { ParsedCall } from "./args.ts";

export async function callUserTool(
  env: Env,
  userId: string,
  call: ParsedCall,
): Promise<ToolResult> {
  if (call.name === "list_folders") {
    const folders = await listFoldersForUser(env.DB, userId);
    const result: ToolResult = {
      ok: true,
      result: {
        folders: folders.map((folder) => ({ id: folder.id, label: folder.label })),
      },
    };
    await record(env, userId, null, call, result);
    return result;
  }
  const listed = await env.DB.prepare(
    `SELECT id, user_id, status, last_seen_at, name FROM devices
     WHERE user_id = ? AND status = 'active'`,
  )
    .bind(userId)
    .all<DeviceRow>();
  const connected = new Set<string>();
  for (const device of listed.results.slice(0, 10)) {
    const stub = env.DEVICE.get(env.DEVICE.idFromName(device.id));
    const presence = await stub.presence();
    if (presence.connected) {
      connected.add(device.id);
    }
  }
  const device = chooseDevice(userId, listed.results, connected);
  if (!device) {
    const result: ToolResult = {
      ok: false,
      error: { code: "unavailable", message: offlineMessage(listed.results) },
    };
    await record(env, userId, null, call, result);
    return result;
  }
  const folders = await listFolders(env.DB, device.id);
  const resolved = resolveFolder(folders, call.folder);
  if (!resolved.ok) {
    const result: ToolResult = { ok: false, error: resolved.error };
    await record(env, userId, device.id, call, result);
    return result;
  }
  const request: InvokeRequest = {
    op: call.name,
    folderId: resolved.folder.id,
    path: call.path,
  };
  if (call.name === "list_files") {
    if (call.limit !== undefined) {
      request.limit = call.limit;
    }
    if (call.cursor !== undefined) {
      request.cursor = call.cursor;
    }
  } else if (call.name === "search_files") {
    request.query = call.query;
    if (call.maxMatches !== undefined) {
      request.maxMatches = call.maxMatches;
    }
  } else if (call.name === "read_media") {
    if (call.maxBytes !== undefined) {
      request.maxBytes = call.maxBytes;
    }
  } else if (call.name === "read_file") {
    if (call.startLine !== undefined) {
      request.startLine = call.startLine;
    }
    if (call.endLine !== undefined) {
      request.endLine = call.endLine;
    }
    if (call.byteOffset !== undefined) {
      request.byteOffset = call.byteOffset;
    }
    if (call.maxBytes !== undefined) {
      request.maxBytes = call.maxBytes;
    }
  }
  const stub = env.DEVICE.get(env.DEVICE.idFromName(device.id));
  const result = await stub.invoke(request);
  await record(env, userId, device.id, call, result, resolved.folder.label);
  return result;
}

// offlineMessage explains why no device could answer, including when the
// most recently seen device was last online, instead of a bare "not
// connected" that gives the user nothing to act on.
function offlineMessage(devices: DeviceRow[]): string {
  const seen = devices
    .map((device) => device.last_seen_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  if (!seen) {
    return "No paired device is connected. Open FolderLink on your computer, then try again.";
  }
  return `No paired device is connected. Last seen ${lastSeenText(seen)}. Open FolderLink on that computer, then try again.`;
}

function lastSeenText(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) {
    return iso;
  }
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000));
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// record writes one audit row per tool call. A logging failure never fails
// the tool call itself, so it is swallowed here.
async function record(
  env: Env,
  userId: string,
  deviceId: string | null,
  call: ParsedCall,
  result: ToolResult,
  folderLabel?: string,
): Promise<void> {
  try {
    await logActivity(env.DB, {
      userId,
      deviceId,
      client: "mcp",
      op: call.name,
      folder:
        folderLabel ??
        (call.name === "list_folders" ? null : "folder" in call ? call.folder : null),
      path: "path" in call ? call.path : null,
      ok: result.ok,
      errorCode: result.ok ? null : result.error.code,
    });
  } catch {
    // The audit log is best effort. The tool result already went out.
  }
}
