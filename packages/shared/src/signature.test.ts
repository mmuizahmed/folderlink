import { describe, expect, it } from "vitest";
import { canonicalJSON } from "./canonical.ts";

const publicKeyHex = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const signature =
  "oExH-zgwa4uEJmxOoIykHxALjG7v3PEnskT0Zx0-HqhQnKAN8PVbogw8u6vzFEnLEjQm0U1kLureOsrqCp8GBQ";

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

describe("signature vector", () => {
  it("verifies a payload signed by the Go bridge", async () => {
    const payload = {
      protocol: 1,
      op: "hello",
      deviceId: "22222222-2222-4222-8222-222222222222",
    };
    const message = new TextEncoder().encode(canonicalJSON(payload));
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKeyHex),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      base64UrlToBytes(signature),
      message,
    );
    expect(ok).toBe(true);
  });
});
