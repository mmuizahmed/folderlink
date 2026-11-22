import { describe, expect, it } from "vitest";
import { localDevEnabled } from "./http.ts";
import type { Env } from "./env.ts";

function request(url: string, host: string): Request {
  return new Request(url, { headers: { host } });
}

const env = { DEV_AUTH: "true" } as Env;

describe("localDevEnabled", () => {
  it("allows localhost only when development sign-in is turned on", () => {
    expect(
      localDevEnabled(request("http://127.0.0.1:8787/api/dev/session", "127.0.0.1:8787"), env),
    ).toBe(true);
    expect(
      localDevEnabled(request("https://mcp.muiz.pk/api/dev/session", "mcp.muiz.pk"), env),
    ).toBe(false);
    expect(
      localDevEnabled(request("http://127.0.0.1:8787/api/dev/session", "127.0.0.1:8787"), {
        DEV_AUTH: "false",
      } as Env),
    ).toBe(false);
  });
});
