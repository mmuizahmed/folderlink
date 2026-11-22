import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalJSON } from "./canonical.ts";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(join(here, "../testdata/canonical.json"), "utf8"),
) as Array<{
  name: string;
  value: unknown;
  canonical: string;
}>;

describe("canonicalJSON", () => {
  for (const vector of vectors) {
    it(vector.name, () => {
      expect(canonicalJSON(vector.value)).toBe(vector.canonical);
    });
  }

  it("rejects fractional numbers", () => {
    expect(() => canonicalJSON({ n: 1.5 })).toThrow(/safe integers/);
  });
});
