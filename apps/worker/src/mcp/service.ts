import type { ToolResult } from "@mcp-bridge/shared";
import type { InvokeRequest } from "../device/control.ts";
import type { Env } from "../env.ts";
import { listFolders } from "../db.ts";
import { chooseDevice, resolveFolder, type DeviceRow } from "../routing.ts";
import type { ParsedCall } from "./args.ts";

export async function callUserTool(
  env: Env,
  userId: string,
  call: ParsedCall,
): Promise<ToolResult> {
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
    return { ok: false, error: { code: "unavailable", message: "No paired device is connected." } };
  }
  const folders = await listFolders(env.DB, device.id);
  const resolved = resolveFolder(folders, call.folder);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
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
  } else {
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
  return stub.invoke(request);
}
