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
    };

export function parseToolCall(
  name: unknown,
  args: unknown,
): { ok: true; call: ParsedCall } | { ok: false; message: string } {
  if (name !== "list_files" && name !== "read_file") {
    return { ok: false, message: "Unknown tool." };
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
