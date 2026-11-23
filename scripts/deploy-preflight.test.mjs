import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { productionProblems } from "./deploy-preflight.mjs";

const current = readFileSync(new URL("../apps/worker/wrangler.toml", import.meta.url), "utf8");
const PRODUCTION_ID = "b7fd5f9d-7bf6-456b-a37f-125c18b5deb9";

describe("production deploy preflight", () => {
  it("accepts the committed production host, database, and asset config", () => {
    expect(current).toContain(`database_id = "${PRODUCTION_ID}"`);
    expect(current).toContain('WEB_ORIGIN = "https://folderlink.muiz.pk"');
    expect(current).toContain('PUBLIC_BASE_URL = "https://folderlink.muiz.pk"');
    expect(current).toContain('pattern = "folderlink.muiz.pk"');
    expect(current).toContain('pattern = "mcp.muiz.pk"');
    expect(current).toContain("workers_dev = false");
    expect(current).toContain("run_worker_first = true");
    expect(current).toContain('directory = "../web/dist"');
    expect(current).toContain('not_found_handling = "single-page-application"');
    expect(productionProblems(current)).toEqual([]);
  });

  it("rejects a production database id that is still the placeholder", () => {
    const toml = current.replaceAll(PRODUCTION_ID, "00000000-0000-0000-0000-000000000001");
    expect(productionProblems(toml).join("\n")).toMatch(/placeholder/);
  });

  it("rejects localhost origins and DEV_AUTH in production", () => {
    const toml = current.replace(
      'WEB_ORIGIN = "https://folderlink.muiz.pk"\nPUBLIC_BASE_URL = "https://folderlink.muiz.pk"',
      'WEB_ORIGIN = "http://localhost:5173"\nPUBLIC_BASE_URL = "http://127.0.0.1:8787"\nDEV_AUTH = "true"',
    );
    const problems = productionProblems(toml).join("\n");
    expect(problems).toMatch(/WEB_ORIGIN/);
    expect(problems).toMatch(/PUBLIC_BASE_URL/);
    expect(problems).toMatch(/DEV_AUTH/);
  });

  it("rejects a config with no production section", () => {
    const toml = current.split("[env.production]")[0] ?? "";
    expect(productionProblems(toml).join("\n")).toMatch(/no \[env.production\]/);
  });
});
