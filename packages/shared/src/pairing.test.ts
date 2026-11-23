import { describe, expect, it } from "vitest";
import { formatPairingCode, normalizePairingCode } from "./pairing.ts";

describe("pairing codes", () => {
  it("accepts a hyphenated code in any case", () => {
    expect(normalizePairingCode("ab3d-ef2h")).toBe("AB3DEF2H");
    expect(formatPairingCode("AB3DEF2H")).toBe("AB3D-EF2H");
  });

  it("rejects ambiguous characters and the wrong length", () => {
    expect(normalizePairingCode("OOOO-OOOO")).toBeNull();
    expect(normalizePairingCode("ABCD-EFG")).toBeNull();
    expect(normalizePairingCode("ABCD-EFG1")).toBeNull();
  });
});
