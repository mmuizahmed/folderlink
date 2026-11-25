import type { ToolResult } from "@folderlink/shared";
import type { InvokeRequest } from "../device/control.ts";
import type { Env } from "../env.ts";
import { publicBaseUrl } from "../env.ts";
import { appIdentity } from "../apps.ts";
import {
  createApproval,
  listFolders,
  listFoldersForUser,
  logActivity,
  setApprovalStatus,
  type GrantRef,
} from "../db.ts";
import { chooseDevice, resolveFolder, type DeviceRow } from "../routing.ts";
import type { ParsedCall } from "./args.ts";

export async function callUserTool(
  env: Env,
  userId: string,
  call: ParsedCall,
  // grant is the OAuth grant behind the caller's bearer token. The folder
  // lists below are scoped to it, so an app only ever sees folders it may
  // use — including list_folders, which is how an app discovers folders.
  // Null means the app is unknown: it sees unrestricted folders only.
  grant: GrantRef | null = null,
): Promise<ToolResult> {
  if (call.name === "list_folders") {
    const folders = await listFoldersForUser(env.DB, userId, grant?.id ?? null);
    const result: ToolResult = {
      ok: true,
      result: {
        folders: folders.map((folder) => ({ id: folder.id, label: folder.label })),
      },
    };
    await record(env, userId, null, call, result, grant);
    return result;
  }
  if (call.name === "exec_poll") {
    return callExecPoll(env, userId, call, grant);
  }
  if (call.name === "run_command" && appIdentity(grant?.name ?? null) === "muse") {
    // run_command is hidden from Muse until the dashboard approval flow
    // ships: Muse has no per-tool toggle, so a listed run_command would
    // be callable without a confirmation card. tools/list hides it too;
    // this is the enforcement, in case the AI calls it anyway.
    const result: ToolResult = {
      ok: false,
      error: {
        code: "unavailable",
        message: "Running commands is not available for this app yet.",
      },
    };
    await record(env, userId, null, call, result, grant);
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
    await record(env, userId, null, call, result, grant);
    return result;
  }
  const folders = await listFolders(env.DB, device.id, grant?.id ?? null);
  const resolved = resolveFolder(folders, call.folder);
  if (!resolved.ok) {
    const result: ToolResult = { ok: false, error: resolved.error };
    await record(env, userId, device.id, call, result, grant);
    return result;
  }
  const request: InvokeRequest = {
    op: call.name,
    folderId: resolved.folder.id,
  };
  if (call.name !== "run_command") {
    // Every other folder tool carries a path; run_command has none.
    request.path = call.path;
  }
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
  } else if (call.name === "write_file") {
    request.content = call.content;
    if (call.encoding !== undefined) {
      request.encoding = call.encoding;
    }
    if (call.approvalId !== undefined) {
      request.approvalId = call.approvalId;
    }
  } else if (call.name === "delete_file") {
    if (call.approvalId !== undefined) {
      request.approvalId = call.approvalId;
    }
  } else if (call.name === "run_command") {
    request.command = call.command;
    request.args = call.args;
    if (call.approvalId !== undefined) {
      request.approvalId = call.approvalId;
    }
  }
  const stub = env.DEVICE.get(env.DEVICE.idFromName(device.id));
  const result = await stub.invoke(request);
  await afterWriteCall(env, userId, device.id, call, result, grant, resolved.folder);
  await record(env, userId, device.id, call, result, grant, resolved.folder.label);
  return result;
}

// callExecPoll routes a poll to the device that started the command. The
// execution id the AI carries is prefixed with that device's id
// (deviceId:exec_...): the worker splits it, checks the device belongs
// to the caller, and passes the bare bridge id on. A foreign device id
// is a not_found, never a leak.
async function callExecPoll(
  env: Env,
  userId: string,
  call: Extract<ParsedCall, { name: "exec_poll" }>,
  grant: GrantRef | null,
): Promise<ToolResult> {
  const colon = call.executionId.indexOf(":");
  const deviceId = call.executionId.slice(0, colon);
  const bridgeId = call.executionId.slice(colon + 1);
  const device = await env.DB.prepare(
    `SELECT id, user_id, status, last_seen_at, name FROM devices
     WHERE id = ? AND user_id = ? AND status = 'active'`,
  )
    .bind(deviceId, userId)
    .first<DeviceRow>();
  if (!device) {
    const result: ToolResult = {
      ok: false,
      error: {
        code: "not_found",
        message: "That command run does not exist or has expired.",
      },
    };
    await record(env, userId, null, call, result, grant);
    return result;
  }
  const stub = env.DEVICE.get(env.DEVICE.idFromName(device.id));
  const result = await stub.invoke({ op: "exec_poll", executionId: bridgeId });
  await record(env, userId, device.id, call, result, grant);
  return result;
}

// afterWriteCall handles the bridge's answer for a write/delete/exec
// call: an approval_required result creates the dashboard row the user
// approves from, and a second call's outcome decides that row. It is
// best effort — a D1 failure is logged, never allowed to fail the tool
// call, because the bridge is the authority and the AI already has the
// dashboard link.
async function afterWriteCall(
  env: Env,
  userId: string,
  deviceId: string,
  call: ParsedCall,
  result: ToolResult,
  grant: GrantRef | null,
  folder: { id: string; label: string },
): Promise<void> {
  if (call.name !== "write_file" && call.name !== "delete_file" && call.name !== "run_command") {
    return;
  }
  const approval = approvalRequiredOf(result);
  if (approval) {
    // The bridge's dashboard link is a fallback: the worker's own
    // PUBLIC_BASE_URL is canonical when it is set.
    const dashboardUrl = env.PUBLIC_BASE_URL
      ? `${publicBaseUrl(env)}/dashboard#approvals/${approval.requestId}`
      : approval.dashboardUrl;
    try {
      await createApproval(env.DB, {
        id: approval.requestId,
        userId,
        deviceId,
        grantId: grant?.id ?? null,
        client: appIdentity(grant?.name ?? null),
        tool: call.name,
        folderId: folder.id,
        folderLabel: folder.label,
        path: approval.path,
        op: approval.operation,
        contentHash: approval.contentHash,
        preHash: approval.preHash,
        diff: approval.diff,
        preview: approval.preview,
        argv: approval.argv ?? [],
        size: approval.size,
        expiresInSeconds: approval.expiresIn,
      });
    } catch (err) {
      console.error("createApproval failed", err instanceof Error ? err.message : err);
    }
    if (result.ok && isRecord(result.result)) {
      result.result.dashboardUrl = dashboardUrl;
    }
    return;
  }
  // A second call (it carried an approval id): decide the row.
  if (!("approvalId" in call) || call.approvalId === undefined) {
    return;
  }
  if (call.name === "run_command" && result.ok) {
    // The command started. Prefix the execution id with this device so
    // exec_poll routes back here, and mark the approval spent.
    const started = result.result as { executionId?: unknown };
    if (isRecord(result.result) && typeof started.executionId === "string") {
      result.result.executionId = `${deviceId}:${started.executionId}`;
    }
  }
  try {
    if (result.ok) {
      await setApprovalStatus(env.DB, userId, call.approvalId, "executed");
    } else if (result.error.code === "approval_denied") {
      await setApprovalStatus(env.DB, userId, call.approvalId, "denied");
    } else if (result.error.code === "approval_expired") {
      await setApprovalStatus(env.DB, userId, call.approvalId, "expired");
    } else {
      await setApprovalStatus(env.DB, userId, call.approvalId, "failed");
    }
  } catch (err) {
    console.error("setApprovalStatus failed", err instanceof Error ? err.message : err);
  }
}

// approvalRequiredOf pulls the approval_required payload out of a bridge
// result, or returns null when the call was not a first-call gate.
function approvalRequiredOf(result: ToolResult): {
  requestId: string;
  operation: string;
  path: string;
  dashboardUrl: string;
  expiresIn: number;
  contentHash: string;
  preHash: string;
  diff: string;
  preview: string;
  argv: string[] | undefined;
  size: number;
} | null {
  if (!result.ok || !isRecord(result.result)) {
    return null;
  }
  const payload = result.result as Record<string, unknown>;
  if (payload.status !== "approval_required" || typeof payload.requestId !== "string") {
    return null;
  }
  return {
    requestId: payload.requestId,
    operation: typeof payload.operation === "string" ? payload.operation : "",
    path: typeof payload.path === "string" ? payload.path : "",
    dashboardUrl: typeof payload.dashboardUrl === "string" ? payload.dashboardUrl : "",
    expiresIn: typeof payload.expiresIn === "number" ? payload.expiresIn : 86_400,
    contentHash: typeof payload.contentHash === "string" ? payload.contentHash : "",
    preHash: typeof payload.preHash === "string" ? payload.preHash : "",
    diff: typeof payload.diff === "string" ? payload.diff : "",
    preview: typeof payload.preview === "string" ? payload.preview : "",
    argv: Array.isArray(payload.argv)
      ? (payload.argv.filter((item) => typeof item === "string") as string[])
      : undefined,
    size: typeof payload.size === "number" ? payload.size : -1,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  grant: GrantRef | null,
  folderLabel?: string,
): Promise<void> {
  try {
    await logActivity(env.DB, {
      userId,
      deviceId,
      // The activity row carries the app identity (chatgpt / claude /
      // muse / unknown), not the literal "mcp": the dashboard shows the
      // right mark for the app that made the call. The identity comes
      // from the grant's registered client name; authorization never
      // depends on it.
      client: appIdentity(grant?.name ?? null),
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
