export const PROTOCOL_VERSION = 1;

export const SUPPORTED_MCP_PROTOCOL_VERSIONS = ["2025-03-26", "2025-06-18"] as const;

export const MESSAGE_TYPES = [
  "hello",
  "hello_ack",
  "ping",
  "pong",
  "request",
  "response",
  "error",
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

export interface FolderClaim {
  id: string;
  label: string;
}

export interface HelloPayload {
  op: "hello";
  protocol: number;
  deviceId: string;
  publicKey: string;
  name: string;
  version: string;
  ts: number;
  nonce: string;
  folders: FolderClaim[];
}

export interface PairBeginPayload {
  op: "pair_begin";
  protocol: number;
  deviceId: string;
  publicKey: string;
  name: string;
  ts: number;
  nonce: string;
}

export interface PairStatusPayload {
  op: "pair_status";
  protocol: number;
  deviceId: string;
  ts: number;
  nonce: string;
}

export interface HelloAckPayload {
  ok: boolean;
  reason?: string;
  heartbeatSec: number;
  approvedFolderIds: string[];
}

export interface ErrorBody {
  code: string;
  message: string;
}

export interface ListFilesParams {
  op: "list_files";
  folderId: string;
  path: string;
  limit?: number;
  cursor?: string;
}

export interface ReadFileParams {
  op: "read_file";
  folderId: string;
  path: string;
  startLine?: number;
  endLine?: number;
  byteOffset?: number;
  maxBytes?: number;
}

export type ToolParams = ListFilesParams | ReadFileParams;

export interface FileEntry {
  name: string;
  kind: "file" | "dir" | "symlink" | "other";
  size: number;
}

export interface ListFilesResult {
  entries: FileEntry[];
  nextCursor: string | null;
  truncated: boolean;
}

export interface ReadFileResult {
  content: string;
  startLine: number;
  endLine: number;
  byteOffset: number;
  bytesRead: number;
  fileSize: number;
  truncated: boolean;
  nextByteOffset: number | null;
}

export interface ToolSuccess {
  ok: true;
  result: ListFilesResult | ReadFileResult;
}

export interface ToolFailure {
  ok: false;
  error: ErrorBody;
}

export type ToolResult = ToolSuccess | ToolFailure;

export interface Envelope<T = unknown> {
  v: number;
  type: MessageType;
  id: string;
  payload?: T;
  sig?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isFolderLabel(value: string): boolean {
  return LABEL_RE.test(value);
}

function isSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isBase64Url(value: unknown, min: number, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= min &&
    value.length <= max &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function readFolders(value: unknown): FolderClaim[] | null {
  if (!Array.isArray(value) || value.length > 32) {
    return null;
  }
  const folders: FolderClaim[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.label !== "string") {
      return null;
    }
    if (!isUuid(item.id) || !isFolderLabel(item.label) || seen.has(item.id)) {
      return null;
    }
    seen.add(item.id);
    folders.push({ id: item.id, label: item.label });
  }
  return folders;
}

function readCommon(value: Record<string, unknown>): {
  protocol: number;
  deviceId: string;
  ts: number;
  nonce: string;
} | null {
  if (
    value.protocol !== PROTOCOL_VERSION ||
    typeof value.deviceId !== "string" ||
    !isUuid(value.deviceId)
  ) {
    return null;
  }
  if (!isSafeInt(value.ts) || !isBase64Url(value.nonce, 16, 128)) {
    return null;
  }
  return {
    protocol: value.protocol,
    deviceId: value.deviceId,
    ts: value.ts,
    nonce: value.nonce,
  };
}

export function parseHelloPayload(value: unknown): HelloPayload | null {
  if (!isRecord(value) || value.op !== "hello") {
    return null;
  }
  const common = readCommon(value);
  const folders = readFolders(value.folders);
  if (
    !common ||
    !folders ||
    typeof value.publicKey !== "string" ||
    !isBase64Url(value.publicKey, 43, 43) ||
    typeof value.name !== "string" ||
    value.name.length < 1 ||
    value.name.length > 60 ||
    typeof value.version !== "string" ||
    value.version.length < 1 ||
    value.version.length > 32
  ) {
    return null;
  }
  return {
    op: "hello",
    ...common,
    publicKey: value.publicKey,
    name: value.name,
    version: value.version,
    folders,
  };
}

export function parsePairBeginPayload(value: unknown): PairBeginPayload | null {
  if (!isRecord(value) || value.op !== "pair_begin") {
    return null;
  }
  const common = readCommon(value);
  if (
    !common ||
    typeof value.publicKey !== "string" ||
    !isBase64Url(value.publicKey, 43, 43) ||
    typeof value.name !== "string" ||
    value.name.length < 1 ||
    value.name.length > 60
  ) {
    return null;
  }
  return {
    op: "pair_begin",
    ...common,
    publicKey: value.publicKey,
    name: value.name,
  };
}

export function parsePairStatusPayload(value: unknown): PairStatusPayload | null {
  if (!isRecord(value) || value.op !== "pair_status") {
    return null;
  }
  const common = readCommon(value);
  if (!common) {
    return null;
  }
  return { op: "pair_status", ...common };
}

export function parseEnvelope(value: unknown): Envelope | null {
  if (!isRecord(value) || value.v !== PROTOCOL_VERSION || typeof value.type !== "string") {
    return null;
  }
  if (!(MESSAGE_TYPES as readonly string[]).includes(value.type) || typeof value.id !== "string") {
    return null;
  }
  if (value.id.length < 1 || value.id.length > 80) {
    return null;
  }
  const envelope: Envelope = {
    v: PROTOCOL_VERSION,
    type: value.type as MessageType,
    id: value.id,
  };
  if (value.payload !== undefined) {
    envelope.payload = value.payload;
  }
  if (value.sig !== undefined) {
    if (typeof value.sig !== "string" || !isBase64Url(value.sig, 80, 100)) {
      return null;
    }
    envelope.sig = value.sig;
  }
  return envelope;
}
