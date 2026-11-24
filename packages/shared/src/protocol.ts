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
  "settings",
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
  // The user's write approval mode ("ai" | "manual"), so the bridge
  // knows how to gate writes before its first tool call.
  writeApprovalMode?: string;
}

// SettingsPayload is a server-push message: the worker sends it when a
// setting changes, so a running bridge learns the new mode without
// waiting for a reconnect. It is fire-and-forget; the bridge applies it
// and caches it locally.
export interface SettingsPayload {
  writeApprovalMode: string;
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

export interface SearchFilesParams {
  op: "search_files";
  folderId: string;
  path: string;
  query: string;
  maxMatches?: number;
}

export interface ReadMediaParams {
  op: "read_media";
  folderId: string;
  path: string;
  maxBytes?: number;
}

export interface FileInfoParams {
  op: "file_info";
  folderId: string;
  path: string;
}

export interface ListFoldersParams {
  op: "list_folders";
}

export interface WriteFileParams {
  op: "write_file";
  folderId: string;
  path: string;
  // content is the exact bytes to write, as a string. encoding "utf8" is
  // plain text; "base64" is binary bytes. Binary writes are always
  // dashboard-gated (see ApprovalRequiredResult).
  content: string;
  encoding?: "utf8" | "base64";
  // approvalId carries a dashboard approval from the first call. Without
  // it, a dashboard-gated write returns approval_required instead of
  // writing; with it, the bridge verifies the single-use token and the
  // content hash before writing.
  approvalId?: string;
}

export interface DeleteFileParams {
  op: "delete_file";
  folderId: string;
  path: string;
  approvalId?: string;
}

export interface RunCommandParams {
  op: "run_command";
  folderId: string;
  // command is a bare program name from the bridge allowlist (no path,
  // no shell). args are passed verbatim; the dashboard shows the exact
  // argv for approval.
  command: string;
  args?: string[];
  approvalId?: string;
}

export interface ExecPollParams {
  op: "exec_poll";
  // executionId is the id returned when run_command started the command.
  // It carries the device id as a prefix, so the worker routes the poll
  // to the device that started the command.
  executionId: string;
}

export interface ApproveRequestParams {
  op: "approve_request";
  requestId: string;
}

export interface DenyRequestParams {
  op: "deny_request";
  requestId: string;
}

export type ToolParams =
  | ListFilesParams
  | ReadFileParams
  | SearchFilesParams
  | ReadMediaParams
  | FileInfoParams
  | ListFoldersParams
  | WriteFileParams
  | DeleteFileParams
  | RunCommandParams
  | ExecPollParams
  | ApproveRequestParams
  | DenyRequestParams;

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

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface SearchFilesResult {
  matches: SearchMatch[];
  filesScanned: number;
  truncated: boolean;
}

export interface ReadMediaResult {
  mimeType: string;
  size: number;
  base64: string;
  truncated: boolean;
}

export interface FileInfoResult {
  name: string;
  kind: "file" | "dir" | "symlink" | "other";
  size: number;
  modTime: string;
  ignored: boolean;
}

export interface ListFoldersResult {
  folders: Array<{ id: string; label: string }>;
}

export interface WriteFileResult {
  written: boolean;
  path: string;
  bytes: number;
  // preHash is the SHA-256 of the file before the write ("absent" for a
  // new file); postHash is the SHA-256 after. The audit log records the
  // hashes, never the content.
  preHash: string;
  postHash: string;
  approvalId?: string;
}

export interface DeleteFileResult {
  deleted: boolean;
  path: string;
  bytes: number;
  preHash: string;
  approvalId?: string;
}

export interface RunCommandResult {
  status: "started";
  executionId: string;
  command: string;
  args: string[];
  approvalId?: string;
}

export interface ExecPollResult {
  status: "running" | "done" | "failed" | "timeout";
  executionId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

// ApprovalRequiredResult is the first call's answer for a dashboard-gated
// operation. It is a success, not an error, so the model can relay it:
// the user approves in the dashboard, then the model re-calls the tool
// with approvalId. The bridge computed the diff/preview from the exact
// bytes that would be written; the worker stores this payload in the
// approvals table for the dashboard to show.
export interface ApprovalRequiredResult {
  status: "approval_required";
  requestId: string;
  operation: "write_file" | "delete_file" | "run_command";
  folder: string;
  path: string;
  dashboardUrl: string;
  expiresIn: string;
  message: string;
  // Write details: the SHA-256 of the exact bytes to write, the SHA-256
  // of the current file ("absent" for a new file), and the bridge-computed
  // unified diff (text) or binary summary (binary writes).
  contentHash?: string;
  preHash?: string;
  diff?: string;
  // Delete details: size and a first-lines preview of what will be lost.
  preview?: string;
  size?: number;
  // Exec details: the exact argv the dashboard shows for approval.
  argv?: string[];
}

export interface ApproveRequestResult {
  approved: boolean;
  requestId: string;
}

export interface ToolSuccess {
  ok: true;
  result:
    | ListFilesResult
    | ReadFileResult
    | SearchFilesResult
    | ReadMediaResult
    | FileInfoResult
    | ListFoldersResult
    | WriteFileResult
    | DeleteFileResult
    | RunCommandResult
    | ExecPollResult
    | ApprovalRequiredResult
    | ApproveRequestResult;
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
