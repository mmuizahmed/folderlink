import { describe, expect, it } from "vitest";
import { applyCors, localDevEnabled, redirectLegacyHost } from "./http.ts";
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
      localDevEnabled(
        request("https://folderlink.muiz.pk/api/dev/session", "folderlink.muiz.pk"),
        env,
      ),
    ).toBe(false);
    expect(
      localDevEnabled(request("http://127.0.0.1:8787/api/dev/session", "127.0.0.1:8787"), {
        DEV_AUTH: "false",
      } as Env),
    ).toBe(false);
  });
});

describe("redirectLegacyHost", () => {
  it("sends the old host to the same path and query", () => {
    const response = redirectLegacyHost(new Request("https://mcp.muiz.pk/pair?code=K7QM-2XPA"));
    expect(response?.status).toBe(301);
    expect(response?.headers.get("location")).toBe(
      "https://folderlink.muiz.pk/pair?code=K7QM-2XPA",
    );
  });

  it("keeps a tricky path on the new host", () => {
    const response = redirectLegacyHost(new Request("https://MCP.MUIZ.PK//evil.example/a?x=1"));
    expect(response?.headers.get("location")).toBe(
      "https://folderlink.muiz.pk//evil.example/a?x=1",
    );
    const location = response?.headers.get("location") ?? "";
    expect(new URL(location).hostname).toBe("folderlink.muiz.pk");
  });

  it("leaves the current host alone", () => {
    expect(redirectLegacyHost(new Request("https://folderlink.muiz.pk/api/health"))).toBeNull();
  });
});

describe("applyCors", () => {
  it("allows the configured site and a same-origin call", () => {
    const env = { WEB_ORIGIN: "https://folderlink.muiz.pk" } as Env;
    const site = applyCors(
      new Request("https://folderlink.muiz.pk/api/me", {
        headers: { origin: "https://folderlink.muiz.pk" },
      }),
      new Response("ok"),
      env,
    );
    expect(site.headers.get("access-control-allow-origin")).toBe("https://folderlink.muiz.pk");
    expect(site.headers.get("access-control-allow-credentials")).toBe("true");

    const preview = applyCors(
      new Request("https://preview.example/api/me", {
        headers: { origin: "https://preview.example" },
      }),
      new Response("ok"),
      env,
    );
    expect(preview.headers.get("access-control-allow-origin")).toBe("https://preview.example");
  });

  it("does not allow a different site", () => {
    const response = applyCors(
      new Request("https://folderlink.muiz.pk/api/me", {
        headers: { origin: "https://evil.example" },
      }),
      new Response("ok"),
      { WEB_ORIGIN: "https://folderlink.muiz.pk" } as Env,
    );
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
