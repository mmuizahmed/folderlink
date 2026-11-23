import { describe, expect, it } from "vitest";
import { handleRequest } from "./app.ts";
import type { Env } from "./env.ts";

describe("GET /api/health", () => {
  it("returns ok without a session", async () => {
    const response = await handleRequest(new Request("https://mcp.muiz.pk/api/health"), {} as Env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
