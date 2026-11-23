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
});
