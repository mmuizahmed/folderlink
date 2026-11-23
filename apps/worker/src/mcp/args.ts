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
  | { name: "list_folders" };

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
    name !== "list_folders"
  ) {
    return { ok: false, message: "Unknown tool." };
  }
  if (name === "list_folders") {
    return { ok: true, call: { name } };
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
