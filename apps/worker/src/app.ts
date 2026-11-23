import {
  isFolderLabel,
  isRecord,
  parsePairBeginPayload,
  parsePairStatusPayload,
} from "@mcp-bridge/shared";
import { exchangeGoogleCode, googleAuthURL, googleConfigured } from "./auth/google.ts";
import { nextFromLoginState, packLoginState, safeNext } from "./auth/return.ts";
import {
  authorizationServerMetadata,
  authorizeGet,
  authorizePost,
  createD1OAuthStore,
  mcpAuthenticateHeader,
  originOf,
  metadataResponse,
  protectedResourceMetadata,
  registerClient,
  token,
} from "./auth/oauth.ts";
import { fingerprint, maskAddress, randomToken, verifySignature } from "./crypto.ts";
import {
  consumePairingCode,
  createMcpSession,
  createSession,
  deleteMcpSession,
  deleteSession,
  deviceByPublicKey,
  ensureDevUser,
  ensureLocalUser,
  getDevice,
  insertDevice,
  listDevicesForUser,
  listFoldersForUser,
  lookupPairingCode,
  mcpSessionValid,
  notePairFailure,
  pairFailureCount,
  pairingCode,
  rememberNonce,
  rememberPickedFolder,
  renameUserFolder,
  saveLoginState,
  savePairingCode,
  setDeviceStatus,
  setFolderApproval,
  takeLoginState,
  touchDeviceMeta,
  unlistUserFolder,
  upsertGoogleUser,
  userForAccessToken,
  userForSession,
} from "./db.ts";
import type { Env } from "./env.ts";
import { publicBaseUrl, webOrigin } from "./env.ts";
import {
  applyCors,
  clearSessionCookie,
  csrfOk,
  error,
  json,
  localDevEnabled,
  readCookie,
  redirectLegacyHost,
  sessionCookie,
} from "./http.ts";
import { handleMcpMessage } from "./mcp/jsonrpc.ts";
import { callUserTool } from "./mcp/service.ts";
import { freshTimestamp } from "./crypto.ts";

type AuthOk = {
  ok: true;
  user: { id: string; status: string; email: string; name: string; avatarUrl: string };
  via: "bearer" | "session";
};
type AuthNo = { ok: false; response: Response };

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const redirected = redirectLegacyHost(request);
  if (redirected) {
    return redirected;
  }
  if (request.method === "OPTIONS") {
    return applyCors(request, new Response(null, { status: 204 }), env);
  }
  const url = new URL(request.url);
  let response: Response;
  try {
    response = await route(request, env, url);
  } catch (err) {
    console.error(err instanceof Error ? err.message : "request failed");
    response = error(500, "internal", "The request could not be completed.");
  }
  if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    return response;
  }
  return applyCors(request, response, env);
}

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  if (
    request.headers.get("Upgrade")?.toLowerCase() === "websocket" &&
    url.pathname.startsWith("/device/")
  ) {
    const deviceId = url.pathname.match(/^\/device\/([^/]+)\/ws$/)?.[1];
    if (!deviceId) {
      return error(404, "not_found", "Not found.");
    }
    const stub = env.DEVICE.get(env.DEVICE.idFromName(deviceId));
    return stub.fetch(request);
  }
  if (
    url.pathname === "/.well-known/oauth-protected-resource" ||
    url.pathname === "/.well-known/oauth-protected-resource/mcp"
  ) {
    return metadataResponse(protectedResourceMetadata(originOf(request, env)));
  }
  if (url.pathname === "/.well-known/oauth-authorization-server") {
    return metadataResponse(authorizationServerMetadata(originOf(request, env)));
  }
  if (url.pathname === "/oauth/register" && request.method === "POST") {
    return registerClient(request, createD1OAuthStore(env.DB));
  }
  if (url.pathname === "/oauth/authorize" && request.method === "GET") {
    return authorizeGet(
      request,
      createD1OAuthStore(env.DB),
      await sessionUser(request, env),
      originOf(request, env),
    );
  }
  if (url.pathname === "/oauth/authorize" && request.method === "POST") {
    return authorizePost(
      request,
      createD1OAuthStore(env.DB),
      await sessionUser(request, env),
      originOf(request, env),
    );
  }
  if (url.pathname === "/oauth/token" && request.method === "POST") {
    return token(request, createD1OAuthStore(env.DB), env);
  }
  if (url.pathname === "/health") {
    return json({ ok: true, version: "0.1.0" });
  }
  if (url.pathname === "/api/health" && request.method === "GET") {
    return json({ ok: true });
  }
  if (url.pathname === "/mcp") {
    return mcp(request, env);
  }
  if (url.pathname === "/api/auth/config" && request.method === "GET") {
    return json({ google: googleConfigured(env), dev: localDevEnabled(request, env) });
  }
  if (url.pathname === "/api/auth/google" && request.method === "GET") {
    return startGoogle(request, env);
  }
  if (url.pathname === "/api/auth/google/callback" && request.method === "GET") {
    return finishGoogle(request, env);
  }
  if (url.pathname === "/api/dev/session" && request.method === "POST") {
    return devSession(request, env);
  }
  if (url.pathname === "/api/dev/pair" && request.method === "POST") {
    return devPair(request, env);
  }
  if (url.pathname === "/api/pair/begin" && request.method === "POST") {
    return pairBegin(request, env);
  }
  if (url.pathname === "/api/pair/preview" && request.method === "GET") {
    return pairPreview(request, env);
  }
  if (url.pathname === "/api/pair/status" && request.method === "POST") {
    return pairStatus(request, env);
  }
  if (url.pathname === "/api/pair/complete" && request.method === "POST") {
    return pairComplete(request, env);
  }
  if (url.pathname === "/api/session/logout" && request.method === "POST") {
    return logout(request, env);
  }
  if (url.pathname === "/api/me" && request.method === "GET") {
    return me(request, env);
  }
  if (url.pathname === "/api/devices" && request.method === "GET") {
    return devices(request, env);
  }
  const revoke = url.pathname.match(/^\/api\/devices\/([^/]+)\/revoke$/);
  if (revoke && request.method === "POST") {
    return revokeDevice(request, env, revoke[1] ?? "");
  }
  if (url.pathname === "/api/folders" && request.method === "GET") {
    return folders(request, env);
  }
  const approval = url.pathname.match(/^\/api\/folders\/([^/]+)\/approval$/);
  if (approval && request.method === "POST") {
    return approveFolder(request, env, approval[1] ?? "");
  }
  if (url.pathname === "/api/apps" && request.method === "GET") {
    return listApps(request, env);
  }
  const revokeApp = url.pathname.match(/^\/api\/apps\/([^/]+)\/revoke$/);
  if (revokeApp && request.method === "POST") {
    return revokeAppGrant(request, env, revokeApp[1] ?? "");
  }
  const pick = url.pathname.match(/^\/api\/devices\/([^/]+)\/folders\/pick$/);
  if (pick && request.method === "POST") {
    return pickFolder(request, env, pick[1] ?? "");
  }
  const renameDevice = url.pathname.match(/^\/api\/devices\/([^/]+)\/rename$/);
  if (renameDevice && request.method === "POST") {
    return renameDeviceName(request, env, renameDevice[1] ?? "");
  }
  const renameFolder = url.pathname.match(/^\/api\/folders\/([^/]+)\/rename$/);
  if (renameFolder && request.method === "POST") {
    return renameFolderLabel(request, env, renameFolder[1] ?? "");
  }
  const removeFolder = url.pathname.match(/^\/api\/folders\/([^/]+)\/remove$/);
  if (removeFolder && request.method === "POST") {
    return removeFolderRow(request, env, removeFolder[1] ?? "");
  }
  if (env.ASSETS && !workerRoute(url.pathname)) {
    return env.ASSETS.fetch(request);
  }
  return error(404, "not_found", "Not found.");
}

function workerRoute(pathname: string): boolean {
  return (
    pathname === "/health" ||
    pathname === "/mcp" ||
    pathname.startsWith("/mcp/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/device/") ||
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/oauth/")
  );
}

async function mcp(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env, "bearer");
  if (!auth.ok) {
    if (auth.response.status === 401) {
      const headers = new Headers(auth.response.headers);
      headers.set("WWW-Authenticate", mcpAuthenticateHeader(originOf(request, env)));
      return new Response(auth.response.body, { status: 401, headers });
    }
    return auth.response;
  }
  if (request.method === "DELETE") {
    const session = request.headers.get("mcp-session-id");
    if (session) {
      await deleteMcpSession(env.DB, session, auth.user.id);
    }
    return new Response(null, { status: 204 });
  }
  if (request.method === "GET") {
    return new Response("This endpoint accepts POST.", {
      status: 405,
      headers: { allow: "POST, DELETE" },
    });
  }
  if (request.method !== "POST") {
    return error(405, "method", "Method not allowed.");
  }
  const accept = request.headers.get("accept");
  if (
    accept &&
    !accept.includes("application/json") &&
    !accept.includes("*/*") &&
    !accept.includes("text/event-stream")
  ) {
    return new Response("Not acceptable", { status: 406 });
  }
  const body = await readBody(request);
  if (body instanceof Response) {
    return body;
  }
  const outcome = await handleMcpMessage(
    body,
    auth.user.id,
    request.headers.get("mcp-session-id"),
    request.headers.get("mcp-protocol-version"),
    {
      folders: async (userId) => {
        const rows = await listFoldersForUser(env.DB, userId);
        return rows.map((row) => ({ label: row.label, approval: row.approval }));
      },
      call: (userId, call) => callUserTool(env, userId, call),
      createSession: (userId, protocol) => createMcpSession(env.DB, userId, protocol),
      sessionValid: (id, userId) => mcpSessionValid(env.DB, id, userId),
      deleteSession: async (id) => {
        await deleteMcpSession(env.DB, id, auth.user.id);
      },
    },
  );
  if (outcome.status === 202) {
    return new Response(null, { status: 202 });
  }
  const headers = new Headers();
  if (outcome.sessionId) {
    headers.set("mcp-session-id", outcome.sessionId);
  }
  return json(outcome.body ?? {}, outcome.status, headers);
}

async function pairBegin(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request);
  if (
    body instanceof Response ||
    !isRecord(body) ||
    !isRecord(body.payload) ||
    typeof body.sig !== "string"
  ) {
    return error(400, "bad_request", "The pairing request is not valid.");
  }
  const payload = parsePairBeginPayload(body.payload);
  if (!payload || !freshTimestamp(payload.ts)) {
    return error(401, "unauthorized", "The pairing request is not valid.");
  }
  if (!(await verifySignature(payload.publicKey, body.payload, body.sig))) {
    return error(401, "unauthorized", "The pairing signature was rejected.");
  }
  if (!(await rememberNonce(env.DB, payload.nonce))) {
    return error(401, "unauthorized", "The pairing request was already used.");
  }
  if (await overLimit(env, `begin:${payload.publicKey}`, 15)) {
    return error(429, "rate_limited", "Too many pairing attempts. Wait a few minutes.");
  }
  const meta = deviceMeta(request, body.payload);
  const byId = await getDevice(env.DB, payload.deviceId);
  const byKey = await deviceByPublicKey(env.DB, payload.publicKey);
  if ((byId && byId.public_key !== payload.publicKey) || (byKey && byKey.id !== payload.deviceId)) {
    return error(409, "conflict", "That device is already registered.");
  }
  const device = byId ?? byKey;
  if (device?.status === "active") {
    return error(409, "conflict", "This device is already paired.");
  }
  if (!device) {
    await insertDevice(env.DB, {
      id: payload.deviceId,
      publicKey: payload.publicKey,
      name: payload.name,
      os: meta.os,
      arch: meta.arch,
      clientIp: meta.clientIp,
      clientRegion: meta.clientRegion,
    });
  } else {
    await touchDeviceMeta(env.DB, device.id, { name: payload.name, ...meta });
  }
  const code = pairingCode();
  const expiresAt = await savePairingCode(env.DB, payload.deviceId, code);
  return json({ deviceId: payload.deviceId, code, expiresAt });
}

async function pairStatus(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request);
  if (
    body instanceof Response ||
    !isRecord(body) ||
    !isRecord(body.payload) ||
    typeof body.sig !== "string"
  ) {
    return error(400, "bad_request", "The pairing request is not valid.");
  }
  const payload = parsePairStatusPayload(body.payload);
  if (!payload || !freshTimestamp(payload.ts)) {
    return error(401, "unauthorized", "The pairing request is not valid.");
  }
  const device = await getDevice(env.DB, payload.deviceId);
  if (!device) {
    return error(404, "not_found", "This device is not registered.");
  }
  if (!(await verifySignature(device.public_key, body.payload, body.sig))) {
    return error(401, "unauthorized", "The pairing signature was rejected.");
  }
  if (!(await rememberNonce(env.DB, payload.nonce))) {
    return error(401, "unauthorized", "The pairing request was already used.");
  }
  return json({ state: device.status });
}

async function pairComplete(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env, "either");
  if (!auth.ok) {
    return auth.response;
  }
  if (!csrfOk(request, auth.via)) {
    return error(403, "forbidden", "The request was rejected.");
  }
  return completeCode(request, env, auth.user.id);
}

async function completeCode(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readBody(request);
  if (body instanceof Response || !isRecord(body) || typeof body.code !== "string") {
    return error(400, "bad_request", "A pairing code is required.");
  }
  if ((await pairFailureCount(env.DB, `complete:${userId}`, 600)) >= 8) {
    return error(429, "rate_limited", "Too many pairing attempts. Wait a few minutes.");
  }
  const consumed = await consumePairingCode(env.DB, body.code);
  if (consumed.status === "expired") {
    await notePairFailure(env.DB, `complete:${userId}`);
    return error(400, "expired", "That pairing code has expired.");
  }
  if (consumed.status !== "ok") {
    await notePairFailure(env.DB, `complete:${userId}`);
    return error(400, "invalid_code", "That pairing code is not valid.");
  }
  const device = await getDevice(env.DB, consumed.device_id);
  if (!device) {
    return error(400, "invalid_code", "That pairing code is not valid.");
  }
  if (device.user_id && device.user_id !== userId && device.status === "active") {
    return error(409, "conflict", "This device is already paired.");
  }
  await setDeviceStatus(env.DB, device.id, "active", userId);
  return json({ deviceId: device.id, status: "active" });
}

async function devSession(request: Request, env: Env): Promise<Response> {
  if (!localDevEnabled(request, env)) {
    return error(404, "not_found", "Not found.");
  }
  const text = await request.text();
  let email = "dev@localhost";
  let name = "Local dev";
  if (text.length > 0) {
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      return error(400, "bad_request", "The body is not valid JSON.");
    }
    if (isRecord(body)) {
      if (typeof body.email === "string") {
        if (!/^[\w.+-]{1,40}@localhost$/.test(body.email)) {
          return error(400, "bad_request", "Use a localhost address for local sign-in.");
        }
        email = body.email;
      }
      if (typeof body.name === "string" && body.name.length > 0 && body.name.length <= 60) {
        name = body.name;
      }
    }
  }
  const user =
    email === "dev@localhost"
      ? await ensureDevUser(env.DB)
      : await ensureLocalUser(env.DB, email, name);
  if (user.status !== "active") {
    return error(403, "suspended", "This account is suspended.");
  }
  const token = randomToken("ms_");
  await createSession(env.DB, user.id, token);
  const headers = new Headers();
  headers.set(
    "set-cookie",
    sessionCookie(token, publicBaseUrl(env).startsWith("https://"), 14 * 24 * 3600),
  );
  return json(
    {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatar_url,
      },
    },
    200,
    headers,
  );
}

async function devPair(request: Request, env: Env): Promise<Response> {
  if (!localDevEnabled(request, env)) {
    return error(404, "not_found", "Not found.");
  }
  const user = await ensureDevUser(env.DB);
  if (user.status !== "active") {
    return error(403, "suspended", "This account is suspended.");
  }
  return completeCode(request, env, user.id);
}

async function startGoogle(request: Request, env: Env): Promise<Response> {
  if (!googleConfigured(env)) {
    return error(404, "signin_unconfigured", "Google sign-in is not configured.");
  }
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  const state = packLoginState(randomToken("st_"), next);
  await saveLoginState(env.DB, state);
  return Response.redirect(googleAuthURL(env, state), 302);
}

async function finishGoogle(request: Request, env: Env): Promise<Response> {
  if (!googleConfigured(env)) {
    return error(404, "signin_unconfigured", "Google sign-in is not configured.");
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code || !(await takeLoginState(env.DB, state))) {
    return error(400, "bad_request", "The sign-in attempt expired.");
  }
  let profile;
  try {
    profile = await exchangeGoogleCode(env, code);
  } catch {
    return error(401, "unauthorized", "Google sign-in failed.");
  }
  const user = await upsertGoogleUser(env.DB, profile);
  if (user.status !== "active") {
    return error(403, "suspended", "This account is suspended.");
  }
  const token = randomToken("ms_");
  await createSession(env.DB, user.id, token);
  const headers = new Headers();
  headers.set(
    "set-cookie",
    sessionCookie(token, publicBaseUrl(env).startsWith("https://"), 14 * 24 * 3600),
  );
  headers.set("location", new URL(nextFromLoginState(state), webOrigin(env)).toString());
  return new Response(null, { status: 302, headers });
}

async function logout(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env, "either");
  if (!auth.ok) {
    return auth.response;
  }
  if (!csrfOk(request, auth.via)) {
    return error(403, "forbidden", "The request was rejected.");
  }
  const cookie = readCookie(request, "session");
  if (cookie) {
    await deleteSession(env.DB, cookie);
  }
  const headers = new Headers();
  headers.set("set-cookie", clearSessionCookie(publicBaseUrl(env).startsWith("https://")));
  return json({ ok: true }, 200, headers);
}

async function me(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env, "either");
  if (!auth.ok) {
    return auth.response;
  }
  return json({ user: auth.user });
}

async function devices(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env, "either");
  if (!auth.ok) {
    return auth.response;
  }
  const rows = await listDevicesForUser(env.DB, auth.user.id);
  const cutoff = Date.now() - 75_000;
  return json({
    devices: rows.map((device) => ({
      id: device.id,
      name: device.name,
      status: device.status,
      lastSeenAt: device.last_seen_at,
      online: device.last_seen_at ? Date.parse(device.last_seen_at) > cutoff : false,
      os: device.os ?? "",
      arch: device.arch ?? "",
      fingerprint: fingerprint(device.public_key),
      network: networkLabel(device.client_ip ?? "", device.client_region ?? ""),
    })),
  });
}

async function revokeDevice(request: Request, env: Env, deviceId: string): Promise<Response> {
  const auth = await authenticate(request, env, "either");
  if (!auth.ok) {
    return auth.response;
  }
  if (!csrfOk(request, auth.via)) {
    return error(403, "forbidden", "The request was rejected.");
  }
  const device = await getDevice(env.DB, deviceId);
  if (!device || device.user_id !== auth.user.id) {
    return error(404, "not_found", "That device was not found.");
  }
  await setDeviceStatus(env.DB, device.id, "revoked", null);
  await env.DEVICE.get(env.DEVICE.idFromName(device.id)).disconnect();
  return json({ ok: true });
}

async function folders(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env, "either");
  if (!auth.ok) {
    return auth.response;
  }
  const rows = await listFoldersForUser(env.DB, auth.user.id);
  return json({
    folders: rows.map((folder) => ({
      id: folder.id,
      label: folder.label,
      approval: folder.approval,
      deviceId: folder.device_id,
      deviceName: folder.device_name,
    })),
  });
}

async function approveFolder(request: Request, env: Env, folderId: string): Promise<Response> {
  const auth = await authenticate(request, env, "either");
  if (!auth.ok) {
    return auth.response;
  }
  if (!csrfOk(request, auth.via)) {
    return error(403, "forbidden", "The request was rejected.");
  }
  const body = await readBody(request);
  if (
    body instanceof Response ||
    !isRecord(body) ||
    (body.approval !== "approved" && body.approval !== "revoked")
  ) {
    return error(400, "bad_request", "approval must be approved or revoked.");
  }
  if ("path" in body) {
    return error(400, "bad_request", "The server does not accept filesystem paths.");
  }
  const ok = await setFolderApproval(env.DB, auth.user.id, folderId, body.approval);
  if (!ok) {
    return error(404, "not_found", "That folder was not found.");
  }
  return json({ ok: true });
}

async function ownedDevice(env: Env, userId: string, deviceId: string) {
  const device = await getDevice(env.DB, deviceId);
  if (!device || device.user_id !== userId || device.status !== "active") {
    return null;
  }
  return device;
}

async function pickFolder(request: Request, env: Env, deviceId: string): Promise<Response> {
  const auth = await authenticate(request, env, "either");
  if (!auth.ok) return auth.response;
  if (!csrfOk(request, auth.via)) return error(403, "forbidden", "The request was rejected.");
  const device = await ownedDevice(env, auth.user.id, deviceId);
  if (!device) return error(404, "not_found", "That device was not found.");
  const stub = env.DEVICE.get(env.DEVICE.idFromName(device.id));
  if (!(await stub.presence()).connected) {
    return error(409, "offline", "Open FolderLink on that computer, then try again.");
  }
  const result = await stub.invoke({ op: "pick_folder" });
  if (!result.ok) {
    return error(400, result.error.code, result.error.message);
  }
  const picked = result.result as { id?: unknown; label?: unknown };
  if (
    typeof picked.id !== "string" ||
    typeof picked.label !== "string" ||
    !isFolderLabel(picked.label)
  ) {
    return error(400, "bad_request", "The folder picker did not return a folder.");
  }
  await rememberPickedFolder(env.DB, device.id, picked.id, picked.label);
  return json({ id: picked.id, label: picked.label });
}

async function renameDeviceName(request: Request, env: Env, deviceId: string): Promise<Response> {
  const auth = await authenticate(request, env, "either");
  if (!auth.ok) return auth.response;
  if (!csrfOk(request, auth.via)) return error(403, "forbidden", "The request was rejected.");
  const body = await readBody(request);
  if (body instanceof Response || !isRecord(body) || typeof body.name !== "string") {
    return error(400, "bad_request", "A device name is required.");
  }
  const name = body.name.trim();
  if (name.length < 1 || name.length > 60) {
    return error(400, "bad_request", "Use a name of 1 to 60 characters.");
  }
  const device = await ownedDevice(env, auth.user.id, deviceId);
  if (!device) return error(404, "not_found", "That device was not found.");
  await env.DB.prepare(`UPDATE devices SET name = ?, updated_at = ? WHERE id = ?`)
    .bind(name, new Date().toISOString(), device.id)
    .run();
  const stub = env.DEVICE.get(env.DEVICE.idFromName(device.id));
  if ((await stub.presence()).connected) {
    await stub.invoke({ op: "rename_device", name });
  }
  return json({ ok: true, name });
}

async function renameFolderLabel(request: Request, env: Env, folderId: string): Promise<Response> {
  const auth = await authenticate(request, env, "either");
  if (!auth.ok) return auth.response;
  if (!csrfOk(request, auth.via)) return error(403, "forbidden", "The request was rejected.");
  const body = await readBody(request);
  if (
    body instanceof Response ||
    !isRecord(body) ||
    typeof body.label !== "string" ||
    !isFolderLabel(body.label)
  ) {
    return error(
      400,
      "bad_request",
      "Use a short folder name: letters, numbers, dots, or hyphens.",
    );
  }
  const folder = await env.DB.prepare(
    `SELECT folders.id, folders.device_id FROM folders
     JOIN devices ON devices.id = folders.device_id
     WHERE folders.id = ? AND devices.user_id = ?`,
  )
    .bind(folderId, auth.user.id)
    .first<{ id: string; device_id: string }>();
  if (!folder) return error(404, "not_found", "That folder was not found.");
  const stub = env.DEVICE.get(env.DEVICE.idFromName(folder.device_id));
  if (!(await stub.presence()).connected) {
    return error(409, "offline", "Open FolderLink on that computer, then try again.");
  }
  const result = await stub.invoke({ op: "rename_folder", folderId, label: body.label });
  if (!result.ok) return error(400, result.error.code, result.error.message);
  await renameUserFolder(env.DB, auth.user.id, folderId, body.label);
  return json({ ok: true });
}

async function removeFolderRow(request: Request, env: Env, folderId: string): Promise<Response> {
  const auth = await authenticate(request, env, "either");
  if (!auth.ok) return auth.response;
  if (!csrfOk(request, auth.via)) return error(403, "forbidden", "The request was rejected.");
  const folder = await env.DB.prepare(
    `SELECT folders.id, folders.device_id FROM folders
     JOIN devices ON devices.id = folders.device_id
     WHERE folders.id = ? AND devices.user_id = ?`,
  )
    .bind(folderId, auth.user.id)
    .first<{ id: string; device_id: string }>();
  if (!folder) return error(404, "not_found", "That folder was not found.");
  const stub = env.DEVICE.get(env.DEVICE.idFromName(folder.device_id));
  if (!(await stub.presence()).connected) {
    return error(409, "offline", "Open FolderLink on that computer, then try again.");
  }
  const result = await stub.invoke({ op: "remove_folder", folderId });
  if (!result.ok) return error(400, result.error.code, result.error.message);
  await unlistUserFolder(env.DB, auth.user.id, folderId);
  return json({ ok: true });
}

async function sessionUser(
  request: Request,
  env: Env,
): Promise<{ id: string; email: string; name: string } | null> {
  const auth = await authenticate(request, env, "either");
  if (!auth.ok || auth.via !== "session") {
    return null;
  }
  return auth.user;
}

async function listApps(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env, "either");
  if (!auth.ok) return auth.response;
  const grants = await createD1OAuthStore(env.DB).grantsForUser(auth.user.id);
  return json({
    apps: grants.map((grant) => ({
      id: grant.id,
      name: grant.name,
      scope: grant.scope,
      createdAt: grant.createdAt,
    })),
  });
}

async function revokeAppGrant(request: Request, env: Env, grantId: string): Promise<Response> {
  const auth = await authenticate(request, env, "either");
  if (!auth.ok) return auth.response;
  if (!csrfOk(request, auth.via)) return error(403, "forbidden", "The request was rejected.");
  const revoked = await createD1OAuthStore(env.DB).revokeGrant(
    grantId,
    auth.user.id,
    new Date().toISOString(),
  );
  if (!revoked) return error(404, "not_found", "That app was not found.");
  return json({ ok: true });
}

async function authenticate(
  request: Request,
  env: Env,
  kind: "bearer" | "either",
): Promise<AuthOk | AuthNo> {
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (bearer) {
    const user = await userForAccessToken(env.DB, bearer);
    if (!user) {
      return { ok: false, response: error(401, "unauthorized", "The token is not valid.") };
    }
    if (user.status !== "active") {
      return { ok: false, response: error(403, "suspended", "This account is suspended.") };
    }
    return {
      ok: true,
      user: {
        id: user.id,
        status: user.status,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatar_url,
      },
      via: "bearer",
    };
  }
  if (kind === "bearer") {
    return { ok: false, response: error(401, "unauthorized", "A bearer token is required.") };
  }
  const cookie = readCookie(request, "session");
  if (!cookie) {
    return { ok: false, response: error(401, "unauthorized", "Sign in is required.") };
  }
  const user = await userForSession(env.DB, cookie);
  if (!user) {
    return { ok: false, response: error(401, "unauthorized", "Sign in is required.") };
  }
  if (user.status !== "active") {
    return { ok: false, response: error(403, "suspended", "This account is suspended.") };
  }
  return {
    ok: true,
    user: {
      id: user.id,
      status: user.status,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url,
    },
    via: "session",
  };
}

async function pairPreview(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env, "either");
  if (!auth.ok) {
    return auth.response;
  }
  const code = new URL(request.url).searchParams.get("code") ?? "";
  const found = await lookupPairingCode(env.DB, code);
  if (found.status === "expired") {
    return error(400, "expired", "That pairing code has expired.");
  }
  if (found.status !== "ok") {
    return error(400, "invalid_code", "That pairing code is not valid.");
  }
  const device = await getDevice(env.DB, found.device_id);
  if (!device) {
    return error(400, "invalid_code", "That pairing code is not valid.");
  }
  return json({
    name: device.name,
    status: device.status,
    os: device.os || "unknown",
    arch: device.arch || "unknown",
    fingerprint: fingerprint(device.public_key),
    network: networkLabel(device.client_ip ?? "", device.client_region ?? ""),
    expiresAt: found.expires_at,
    folders: "none yet — you choose after pairing",
  });
}

async function overLimit(env: Env, bucket: string, limit: number): Promise<boolean> {
  const count = await pairFailureCount(env.DB, bucket, 600);
  if (count >= limit) {
    return true;
  }
  await notePairFailure(env.DB, bucket);
  return false;
}

function deviceMeta(
  request: Request,
  payload: Record<string, unknown>,
): {
  os: string;
  arch: string;
  clientIp: string;
  clientRegion: string;
} {
  const os = typeof payload.os === "string" ? payload.os.slice(0, 32) : "";
  const arch = typeof payload.arch === "string" ? payload.arch.slice(0, 32) : "";
  const headerIp =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "";
  const region = request.headers.get("cf-ipcountry") ?? "";
  return { os, arch, clientIp: headerIp.slice(0, 64), clientRegion: region.slice(0, 8) };
}

function networkLabel(ip: string, region: string): string {
  const masked = maskAddress(ip);
  if (region && region !== "XX") {
    return `${masked} · ${region}`;
  }
  return masked;
}

async function readBody(request: Request): Promise<unknown | Response> {
  const text = await request.text();
  if (text.length > 256_000) {
    return error(413, "too_large", "The request is too large.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return error(400, "bad_request", "The body is not valid JSON.");
  }
}
