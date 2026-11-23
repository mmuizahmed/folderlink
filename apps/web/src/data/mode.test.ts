import { describe, expect, it } from "vitest";
import { initials, screenMode } from "./mode.ts";

describe("screen mode", () => {
  it("reads the fixture query", () => {
    expect(screenMode("")).toBe("live");
    expect(screenMode("?fixture=1")).toBe("fixture");
    expect(screenMode("?fixture=empty")).toBe("empty");
    expect(screenMode("?fixture=long")).toBe("long");
  });

  it("builds initials without inventing a name", () => {
    expect(initials("Local dev", "dev@localhost")).toBe("LD");
    expect(initials("", "dev@localhost")).toBe("DE");
  });
});
