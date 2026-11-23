import type { DeviceAgent } from "./device/agent.ts";

export interface Env {
  DB: D1Database;
  DEVICE: DurableObjectNamespace<DeviceAgent>;
  DEV_AUTH?: string;
  WEB_ORIGIN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  PUBLIC_BASE_URL?: string;
  TOKEN_TTL_SECONDS?: string;
}

export function webOrigin(env: Env): string {
  return env.WEB_ORIGIN ?? "http://localhost:5173";
}

export function publicBaseUrl(env: Env): string {
  return env.PUBLIC_BASE_URL ?? "http://127.0.0.1:8787";
}

export function tokenTtlSeconds(env: Env): number {
  const parsed = Number(env.TOKEN_TTL_SECONDS ?? "2700");
  if (!Number.isFinite(parsed) || parsed < 60 || parsed > 3600) {
    return 2700;
  }
  return Math.floor(parsed);
}
