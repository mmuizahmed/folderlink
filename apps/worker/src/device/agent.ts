import { DurableObject } from "cloudflare:workers";
import { parseEnvelope, parseHelloPayload, type ToolResult } from "@mcp-bridge/shared";
import { freshTimestamp, verifySignature } from "../crypto.ts";
import { setDeviceVersion, syncFolders, touchDevice, type DeviceRecord } from "../db.ts";
import type { Env } from "../env.ts";
import type { InvokeRequest } from "./control.ts";

const pickerOperationTimeout = inputOp(input: InvokeRequest): number => {
  // Folder selection is an interactive operation and may take much longer
  // than ordinary file reads.
  void input;
  return 10 * 60 * 1000;
};

interface Attachment {
  deviceId: string;
  authenticated: boolean;
  userId?: string;
}

export class DeviceAgent extends DurableObject<Env> {
  private pending = new Map<string, (payload: unknown) => void>();
  private schemaReady = false;

  async fetch(request: Request): Promise<Response> {
    try {
      const upgrade = request.headers.get("Upgrade");
      const deviceId = new URL(request.url).pathname.match(/\/device\/([^/]+)\/ws$/)?.[1];
      if (upgrade?.toLowerCase() !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      if (!deviceId) {
        return new Response("not found", { status: 404 });
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      if (!client || !server) {
        return new Response("websocket unavailable", { status: 500 });
      }
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ deviceId, authenticated: false } satisfies Attachment);
      return new Response(null, { status: 101, webSocket: client });
    } catch (err) {
      console.error("device fetch failed", err instanceof Error ? err.stack : err);
      return new Response("device error", { status: 500 });
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > 1_000_000) {
      ws.close(4000, "unsupported message");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      ws.close(4000, "invalid json");
      return;
    }
    const envelope = parseEnvelope(parsed);
    if (!envelope) {
      ws.close(4000, "invalid envelope");
      return;
    }
    if (envelope.type === "response" || envelope.type === "error") {
      const waiter = this.pending.get(envelope.id);
      if (waiter) {
        waiter(envelope.payload);
      }
      return;
    }
    if (envelope.type === "ping") {
      ws.send(
        JSON.stringify({
          v: 1,
          type: "pong",
          id: envelope.id,
          payload: { ts: Math.floor(Date.now() / 1000) },
        }),
      );
      const attachment = this.attachment(ws);
      if (attachment?.authenticated) {
        await this.touch(attachment.deviceId);
      }
      return;
    }
    if (envelope.type === "hello") {
      await this.onHello(ws, envelope.id, envelope.payload, envelope.sig);
      return;
    }
  }

  async webSocketClose(): Promise<void> {
    // Hibernation keeps the record of the socket. Nothing else is required here.
  }

  async presence(): Promise<{ connected: boolean }> {
    return { connected: this.authenticatedSocket() !== null };
  }

  async disconnect(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      ws.close(4003, "revoked");
    }
  }

  async invoke(input: InvokeRequest): Promise<ToolResult> {
    const ws = this.authenticatedSocket();
    if (!ws) {
      return { ok: false, error: { code: "unavailable", message: "The device is not connected." } };
    }
    const id = crypto.randomUUID();
    const payload: Record<string, unknown> = { op: input.op };
    if (input.folderId !== undefined) payload.folderId = input.folderId;
    if (input.path !== undefined) payload.path = input.path;
    if (input.limit !== undefined) payload.limit = input.limit;
    if (input.cursor !== undefined) payload.cursor = input.cursor;
    if (input.startLine !== undefined) payload.startLine = input.startLine;
    if (input.endLine !== undefined) payload.endLine = input.endLine;
    if (input.byteOffset !== undefined) payload.byteOffset = input.byteOffset;
    if (input.maxBytes !== undefined) payload.maxBytes = input.maxBytes;
    if (input.label !== undefined) payload.label = input.label;
    if (input.name !== undefined) payload.name = input.name;
    try {
      ws.send(JSON.stringify({ v: 1, type: "request", id, payload }));
    } catch {
      return { ok: false, error: { code: "unavailable", message: "The device is not connected." } };
    }
    const timeout = input.op === "pick_folder" ? 10 * 60 * 1000 : 15_000;
    return await new Promise<ToolResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({
          ok: false,
          error: { code: "timeout", message: "The device did not respond in time." },
        });
      }, timeout);
      this.pending.set(id, (response) => {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(interpret(response));
      });
    });
  }

  private async onHello(
    ws: WebSocket,
    id: string,
    payload: unknown,
    sig: string | undefined,
  ): Promise<void> {
    const attachment = this.attachment(ws);
    const hello = parseHelloPayload(payload);
    if (!attachment || !hello || !sig || hello.deviceId !== attachment.deviceId) {
      this.reject(ws, id, "unpaired");
      return;
    }
    if (!freshTimestamp(hello.ts) || !this.useNonce(hello.nonce, hello.ts)) {
      this.reject(ws, id, "unpaired");
      return;
    }
    const device = await this.env.DB.prepare("SELECT * FROM devices WHERE id = ?")
      .bind(hello.deviceId)
      .first<DeviceRecord>();
    if (
      !device ||
      device.public_key !== hello.publicKey ||
      device.status !== "active" ||
      !device.user_id
    ) {
      this.reject(ws, id, device?.status === "revoked" ? "revoked" : "unpaired");
      return;
    }
    if (!(await verifySignature(device.public_key, payload, sig))) {
      this.reject(ws, id, "unpaired");
      return;
    }
    const user = await this.env.DB.prepare("SELECT status FROM users WHERE id = ?")
      .bind(device.user_id)
      .first<{ status: string }>();
    if (!user || user.status !== "active") {
      this.reject(ws, id, "unpaired");
      return;
    }
    let approved: string[] = [];
    try {
      approved = await syncFolders(this.env.DB, device.id, hello.folders);
    } catch {
      this.reject(ws, id, "unpaired");
      return;
    }
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) {
        other.close(4002, "replaced");
      }
    }
    const next: Attachment = { deviceId: device.id, authenticated: true, userId: device.user_id };
    ws.serializeAttachment(next);
    if (hello.version) {
      await setDeviceVersion(this.env.DB, device.id, hello.version);
    }
    await this.touch(device.id);
    ws.send(
      JSON.stringify({
        v: 1,
        type: "hello_ack",
        id,
        payload: { ok: true, heartbeatSec: 20, approvedFolderIds: approved },
      }),
    );
  }

  private reject(ws: WebSocket, id: string, reason: string): void {
    ws.send(
      JSON.stringify({
        v: 1,
        type: "hello_ack",
        id,
        payload: { ok: false, reason, heartbeatSec: 20, approvedFolderIds: [] },
      }),
    );
    ws.close(4003, reason);
  }

  private authenticatedSocket(): WebSocket | null {
    for (const ws of this.ctx.getWebSockets()) {
      if (this.attachment(ws)?.authenticated) {
        return ws;
      }
    }
    return null;
  }

  private attachment(ws: WebSocket): Attachment | null {
    const value = ws.deserializeAttachment() as unknown;
    if (!value || typeof value !== "object") {
      return null;
    }
    const record = value as Partial<Attachment>;
    if (typeof record.deviceId !== "string" || typeof record.authenticated !== "boolean") {
      return null;
    }
    if (record.userId === undefined) {
      return { deviceId: record.deviceId, authenticated: record.authenticated };
    }
    if (typeof record.userId !== "string") {
      return null;
    }
    return {
      deviceId: record.deviceId,
      authenticated: record.authenticated,
      userId: record.userId,
    };
  }

  private ensureSchema(): void {
    if (this.schemaReady) {
      return;
    }
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, seen_at INTEGER NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    this.schemaReady = true;
  }

  private useNonce(nonce: string, ts: number): boolean {
    this.ensureSchema();
    if (!freshTimestamp(ts)) {
      return false;
    }
    this.ctx.storage.sql.exec("DELETE FROM nonces WHERE seen_at < ?", Date.now() - 10 * 60 * 1000);
    try {
      this.ctx.storage.sql.exec(
        "INSERT INTO nonces (nonce, seen_at) VALUES (?, ?)",
        nonce,
        Date.now(),
      );
      return true;
    } catch {
      return false;
    }
  }

  private async touch(deviceId: string): Promise<void> {
    this.ensureSchema();
    const rows = this.ctx.storage.sql.exec("SELECT value FROM kv WHERE key = 'seen'").toArray();
    const previous = Number(rows[0]?.value ?? 0);
    if (Date.now() - previous < 30_000) {
      return;
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO kv (key, value) VALUES ('seen', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      String(Date.now()),
    );
    await touchDevice(this.env.DB, deviceId);
  }
}

function interpret(payload: unknown): ToolResult {
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      error: { code: "internal", message: "The device returned an unreadable result." },
    };
  }
  const record = payload as {
    ok?: unknown;
    result?: unknown;
    error?: { code?: unknown; message?: unknown };
  };
  if (record.ok === true && record.result && typeof record.result === "object") {
    const encoded = JSON.stringify(record.result);
    if (encoded.length > 300_000) {
      return { ok: false, error: { code: "too_large", message: "The result was too large." } };
    }
    return {
      ok: true,
      result: record.result as ToolResult extends { ok: true; result: infer R } ? R : never,
    };
  }
  const code = typeof record.error?.code === "string" ? record.error.code : "internal";
  const message =
    typeof record.error?.message === "string" ? record.error.message : "The request failed.";
  return { ok: false, error: { code, message } };
}
