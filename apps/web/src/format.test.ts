import { describe, expect, it } from "vitest";
import { formatWhen } from "./format.ts";

describe("formatWhen", () => {
  const now = Date.parse("2026-11-22T12:00:00.000Z");

  it("formats recent times and an empty value", () => {
    expect(formatWhen(null, now)).toBe("Never");
    expect(formatWhen("2026-11-22T11:59:55.000Z", now)).toBe("Just now");
    expect(formatWhen("2026-11-22T11:30:00.000Z", now)).toBe("30m ago");
  });
});
