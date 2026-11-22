import { canonicalJSON } from "@mcp-bridge/shared";

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken(prefix: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return prefix + base64Url(bytes);
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function freshTimestamp(ts: number, now = Date.now()): boolean {
  return Math.abs(now - ts * 1000) <= 5 * 60 * 1000;
}

export async function verifySignature(
  publicKey: string,
  payload: unknown,
  signature: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      base64UrlToBytes(publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const data = new TextEncoder().encode(canonicalJSON(payload));
    return await crypto.subtle.verify({ name: "Ed25519" }, key, base64UrlToBytes(signature), data);
  } catch {
    return false;
  }
}
