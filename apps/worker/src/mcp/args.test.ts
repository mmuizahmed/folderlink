import { describe, expect, it } from "vitest";
import { parseToolCall } from "./args.ts";

describe("parseToolCall", () => {
  it("keeps the folder label and drops a client-supplied device id", () => {
    const parsed = parseToolCall("read_file", {
      folder: "notes",
      path: "hello.txt",
      deviceId: "someone-elses-device",
      device_id: "also-ignored",
    });
    expect(parsed).toEqual({
      ok: true,
      call: { name: "read_file", folder: "notes", path: "hello.txt" },
    });
    expect(JSON.stringify(parsed)).not.toContain("someone-elses-device");
  });

  it("rejects an unknown tool", () => {
    expect(parseToolCall("exec", { folder: "notes" }).ok).toBe(false);
  });

  it("parses write_file with encoding and approval id", () => {
    expect(
      parseToolCall("write_file", {
        folder: "notes",
        path: "a.md",
        content: "hello\n",
        encoding: "utf8",
      }),
    ).toEqual({
      ok: true,
      call: {
        name: "write_file",
        folder: "notes",
        path: "a.md",
        content: "hello\n",
        encoding: "utf8",
      },
    });
    expect(
      parseToolCall("write_file", {
        folder: "notes",
        path: "run.ps1",
        content: "aGVsbG8=",
        encoding: "base64",
        approval_id: "123e4567-e89b-42d3-a456-426614174000",
      }),
    ).toEqual({
      ok: true,
      call: {
        name: "write_file",
        folder: "notes",
        path: "run.ps1",
        content: "aGVsbG8=",
        encoding: "base64",
        approvalId: "123e4567-e89b-42d3-a456-426614174000",
      },
    });
  });

  it("rejects write_file without content and with a bad approval id", () => {
    expect(parseToolCall("write_file", { folder: "notes", path: "a.md" }).ok).toBe(false);
    expect(
      parseToolCall("write_file", {
        folder: "notes",
        path: "a.md",
        content: "x",
        approval_id: "not-a-uuid",
      }).ok,
    ).toBe(false);
    expect(
      parseToolCall("write_file", { folder: "notes", path: "a.md", content: "x", encoding: "hex" })
        .ok,
    ).toBe(false);
  });

  it("parses run_command and rejects a path-like command", () => {
    expect(
      parseToolCall("run_command", { folder: "notes", command: "git", args: ["status"] }),
    ).toEqual({
      ok: true,
      call: { name: "run_command", folder: "notes", command: "git", args: ["status"] },
    });
    expect(parseToolCall("run_command", { folder: "notes", command: "/bin/rm" }).ok).toBe(false);
    expect(
      parseToolCall("run_command", { folder: "notes", command: "git", args: "status" }).ok,
    ).toBe(false);
  });

  it("parses exec_poll and rejects a bare id", () => {
    expect(parseToolCall("exec_poll", { execution_id: "device-1:exec_abcdef" })).toEqual({
      ok: true,
      call: { name: "exec_poll", executionId: "device-1:exec_abcdef" },
    });
    expect(parseToolCall("exec_poll", { execution_id: "exec_abcdef" }).ok).toBe(false);
    expect(parseToolCall("exec_poll", {}).ok).toBe(false);
  });

  it("parses delete_file with an approval id", () => {
    expect(
      parseToolCall("delete_file", {
        folder: "notes",
        path: "old.txt",
        approval_id: "123e4567-e89b-42d3-a456-426614174000",
      }),
    ).toEqual({
      ok: true,
      call: {
        name: "delete_file",
        folder: "notes",
        path: "old.txt",
        approvalId: "123e4567-e89b-42d3-a456-426614174000",
      },
    });
  });
});
