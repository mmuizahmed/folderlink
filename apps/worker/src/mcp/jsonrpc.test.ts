import { describe, expect, it } from "vitest";
import type { ParsedCall } from "./args.ts";
import { handleMcpMessage, type McpDeps } from "./jsonrpc.ts";

function deps(calls: ParsedCall[]): McpDeps {
  return {
    folders: async () => [{ label: "notes", approval: "approved" }],
    call: async (_userId, call) => {
      calls.push(call);
      return {
        ok: true,
        result: {
          content: "hello from the bridge",
          startLine: 1,
          endLine: 1,
          byteOffset: 0,
          bytesRead: 22,
          fileSize: 22,
          truncated: false,
          nextByteOffset: null,
        },
      };
    },
    createSession: async () => "session-1",
    sessionValid: async (id) => id === "session-1",
    deleteSession: async () => undefined,
  };
}

describe("handleMcpMessage", () => {
  it("initializes, lists tools, and routes a read without a client device id", async () => {
    const calls: ParsedCall[] = [];
    const used = deps(calls);
    const init = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      },
      "user-1",
      null,
      null,
      used,
    );
    expect(init.sessionId).toBe("session-1");
    expect(JSON.stringify(init.body)).toContain("notes");

    const list = await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      "user-1",
      "session-1",
      "2025-03-26",
      used,
    );
    expect(JSON.stringify(list.body)).toContain("list_files");
    expect(JSON.stringify(list.body)).toContain("read_file");

    const read = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: { folder: "notes", path: "hello.txt", deviceId: "other-device" },
        },
      },
      "user-1",
      "session-1",
      "2025-03-26",
      used,
    );
    expect(calls).toEqual([{ name: "read_file", folder: "notes", path: "hello.txt" }]);
    expect(JSON.stringify(read.body)).toContain("hello from the bridge");
    expect(JSON.stringify(calls)).not.toContain("other-device");
  });

  it("rejects a tool call without a session", async () => {
    const outcome = await handleMcpMessage(
      { jsonrpc: "2.0", id: 4, method: "tools/list" },
      "user-1",
      null,
      "2025-03-26",
      deps([]),
    );
    expect(outcome.status).toBe(400);
  });
});
