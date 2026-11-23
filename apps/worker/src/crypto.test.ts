import { describe, expect, it } from "vitest";
import { fingerprint, maskAddress } from "./crypto.ts";

describe("device display helpers", () => {
  it("masks a public address and keeps loopback local", () => {
    expect(maskAddress("127.0.0.1")).toBe("local");
    expect(maskAddress("39.45.12.8")).toBe("39.45.x.x");
    expect(maskAddress("")).toBe("local");
  });

  it("shows a short key fingerprint", () => {
    const raw = new Uint8Array(32).map((_, index) => index);
    let binary = "";
    for (const byte of raw) binary += String.fromCharCode(byte);
    const key = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    expect(fingerprint(key)).toMatch(/^ed25519:[0-9A-F]{4}…[0-9A-F]{4}$/);
  });
});
