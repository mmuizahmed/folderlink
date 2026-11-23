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

export function fingerprint(publicKey: string): string {
  const bytes = base64UrlToBytes(publicKey);
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  if (hex.length < 8) {
    return "ed25519:unknown";
  }
  return `ed25519:${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

export function maskAddress(ip: string): string {
  if (ip === "" || ip === "127.0.0.1" || ip === "::1" || ip === "localhost") {
    return "local";
  }
  const parts = ip.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    return `${parts[0]}.${parts[1]}.x.x`;
  }
  return "unknown";
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
