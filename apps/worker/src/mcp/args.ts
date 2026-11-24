export type ParsedCall =
  | { name: "list_files"; folder: string; path: string; limit?: number; cursor?: string }
  | {
      name: "read_file";
      folder: string;
      path: string;
      startLine?: number;
      endLine?: number;
      byteOffset?: number;
      maxBytes?: number;
    }
  | {
      name: "search_files";
      folder: string;
      path: string;
      query: string;
      maxMatches?: number;
    }
  | { name: "read_media"; folder: string; path: string; maxBytes?: number }
  | { name: "file_info"; folder: string; path: string }
  | { name: "list_folders" }
  | {
      name: "write_file";
      folder: string;
      path: string;
      content: string;
      encoding?: "utf8" | "base64";
      approvalId?: string;
    }
  | { name: "delete_file"; folder: string; path: string; approvalId?: string }
  | {
      name: "run_command";
      folder: string;
      command: string;
      args: string[];
      approvalId?: string;
    }
  | { name: "exec_poll"; executionId: string };

export function parseToolCall(
  name: unknown,
  args: unknown,
): { ok: true; call: ParsedCall } | { ok: false; message: string } {
  if (
    name !== "list_files" &&
    name !== "read_file" &&
    name !== "search_files" &&
    name !== "read_media" &&
    name !== "file_info" &&
    name !== "list_folders" &&
    name !== "write_file" &&
    name !== "delete_file" &&
    name !== "run_command" &&
    name !== "exec_poll"
  ) {
    return { ok: false, message: "Unknown tool." };
  }
  if (name === "list_folders") {
    return { ok: true, call: { name } };
  }
  if (name === "exec_poll") {
    // exec_poll carries no folder: the execution id is prefixed with the
    // device id (deviceId:exec_...), which is how the worker routes it.
    if (!isRecord(args) || typeof args.execution_id !== "string") {
      return { ok: false, message: "execution_id is required." };
    }
    const executionId = args.execution_id;
    const colon = executionId.indexOf(":");
    if (
      colon <= 0 ||
      executionId.length > 256 ||
      !executionId.slice(colon + 1).startsWith("exec_")
    ) {
      return { ok: false, message: "execution_id is not valid." };
    }
    return { ok: true, call: { name, executionId } };
  }
  if (!isRecord(args)) {
    return { ok: false, message: "Tool arguments must be an object." };
  }
  if (typeof args.folder !== "string" || args.folder.trim() === "") {
    return { ok: false, message: "folder is required." };
  }
  const path = typeof args.path === "string" ? args.path : "";
  if (name === "list_files") {
    const call: ParsedCall = { name, folder: args.folder, path };
    const limit = optionalInt(args.limit);
    const cursor = optionalString(args.cursor);
    if (limit === "bad" || cursor === "bad") {
      return { ok: false, message: "list_files arguments are not valid." };
    }
    if (typeof limit === "number") {
      call.limit = limit;
    }
    if (typeof cursor === "string") {
      call.cursor = cursor;
    }
    return { ok: true, call };
  }
  if (name === "search_files") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (query === "" || query.length > 200) {
      return { ok: false, message: "query is required, 1 to 200 characters." };
    }
    const maxMatches = optionalInt(args.max_matches);
    if (maxMatches === "bad" || (typeof maxMatches === "number" && maxMatches > 100)) {
      return { ok: false, message: "search_files arguments are not valid." };
    }
    const call: ParsedCall = { name, folder: args.folder, path, query };
    if (typeof maxMatches === "number") {
      call.maxMatches = maxMatches;
    }
    return { ok: true, call };
  }
  if (name === "read_media") {
    const maxBytes = optionalInt(args.max_bytes);
    if (maxBytes === "bad") {
      return { ok: false, message: "read_media arguments are not valid." };
    }
    const call: ParsedCall = { name, folder: args.folder, path };
    if (typeof maxBytes === "number") {
      call.maxBytes = maxBytes;
    }
    return { ok: true, call };
  }
  if (name === "file_info") {
    return { ok: true, call: { name, folder: args.folder, path } };
  }
  if (name === "write_file") {
    if (typeof args.content !== "string" || args.content.length > 270_000) {
      return { ok: false, message: "content is required, at most 200 KB of file bytes." };
    }
    const call: ParsedCall = { name, folder: args.folder, path, content: args.content };
    if (args.encoding !== undefined) {
      if (args.encoding !== "utf8" && args.encoding !== "base64") {
        return { ok: false, message: "encoding must be utf8 or base64." };
      }
      call.encoding = args.encoding;
    }
    const approvalId = optionalApprovalId(args.approval_id);
    if (approvalId === "bad") {
      return { ok: false, message: "approval_id is not valid." };
    }
    if (approvalId !== undefined) {
      call.approvalId = approvalId;
    }
    return { ok: true, call };
  }
  if (name === "delete_file") {
    const call: ParsedCall = { name, folder: args.folder, path };
    const approvalId = optionalApprovalId(args.approval_id);
    if (approvalId === "bad") {
      return { ok: false, message: "approval_id is not valid." };
    }
    if (approvalId !== undefined) {
      call.approvalId = approvalId;
    }
    return { ok: true, call };
  }
  if (name === "run_command") {
    if (
      typeof args.command !== "string" ||
      args.command.length === 0 ||
      args.command.length > 64 ||
      args.command.includes("/") ||
      args.command.includes("\\")
    ) {
      return { ok: false, message: "command is required, a bare command name." };
    }
    const commandArgs = optionalStringArray(args.args);
    if (commandArgs === "bad") {
      return { ok: false, message: "args must be an array of strings, at most 32." };
    }
    const call: ParsedCall = {
      name,
      folder: args.folder,
      command: args.command,
      args: commandArgs ?? [],
    };
    const approvalId = optionalApprovalId(args.approval_id);
    if (approvalId === "bad") {
      return { ok: false, message: "approval_id is not valid." };
    }
    if (approvalId !== undefined) {
      call.approvalId = approvalId;
    }
    return { ok: true, call };
  }
  const call: ParsedCall = { name, folder: args.folder, path };
  const startLine = optionalInt(args.start_line);
  const endLine = optionalInt(args.end_line);
  const byteOffset = optionalInt(args.byte_offset);
  const maxBytes = optionalInt(args.max_bytes);
  if ([startLine, endLine, byteOffset, maxBytes].includes("bad")) {
    return { ok: false, message: "read_file arguments are not valid." };
  }
  if (typeof startLine === "number") {
    call.startLine = startLine;
  }
  if (typeof endLine === "number") {
    call.endLine = endLine;
  }
  if (typeof byteOffset === "number") {
    call.byteOffset = byteOffset;
  }
  if (typeof maxBytes === "number") {
    call.maxBytes = maxBytes;
  }
  return { ok: true, call };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalInt(value: unknown): number | undefined | "bad" {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return "bad";
  }
  return value;
}

function optionalString(value: unknown): string | undefined | "bad" {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length > 512) {
    return "bad";
  }
  return value;
}

// optionalApprovalId validates the dashboard approval id carried on the
// second call of a two-turn flow. It must be the UUID the bridge minted;
// anything else is rejected here so a malformed id never reaches the
// bridge.
function optionalApprovalId(value: unknown): string | undefined | "bad" {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    return "bad";
  }
  return value;
}

function optionalStringArray(value: unknown): string[] | undefined | "bad" {
  if (value === undefined) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    value.length > 32 ||
    value.some((item) => typeof item !== "string" || item.length > 1024)
  ) {
    return "bad";
  }
  return value as string[];
}
