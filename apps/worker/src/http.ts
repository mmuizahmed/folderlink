import type { Env } from "./env.ts";
import { webOrigin } from "./env.ts";

export function json(data: unknown, status = 200, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { status, headers });
}

export function error(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

const LEGACY_HOST = "mcp.muiz.pk";
const CANONICAL_ORIGIN = "https://folderlink.muiz.pk";

export function redirectLegacyHost(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.hostname.toLowerCase() !== LEGACY_HOST) {
    return null;
  }
  const target = new URL(CANONICAL_ORIGIN);
  target.pathname = url.pathname;
  target.search = url.search;
  if (target.protocol !== "https:" || target.hostname !== "folderlink.muiz.pk") {
    return null;
  }
  return new Response(null, {
    status: 301,
    headers: {
      location: target.toString(),
      "cache-control": "no-store",
    },
  });
}

export function localDevEnabled(request: Request, env: Env): boolean {
  if (env.DEV_AUTH !== "true") {
    return false;
  }
  const urlHost = new URL(request.url).hostname.toLowerCase();
  const headerHost = (request.headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  return isLocalHost(urlHost) && isLocalHost(headerHost);
}

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export function applyCors(request: Request, response: Response, env: Env): Response {
  const headers = new Headers(response.headers);
  const path = new URL(request.url).pathname;
  if (path === "/mcp") {
    headers.set("access-control-allow-origin", "*");
    headers.set(
      "access-control-allow-headers",
      "authorization, content-type, accept, mcp-protocol-version, mcp-session-id",
    );
    headers.set("access-control-allow-methods", "POST, DELETE, OPTIONS");
    headers.set("access-control-expose-headers", "mcp-session-id");
  } else if (path.startsWith("/api/")) {
    const origin = request.headers.get("origin");
    const sameOrigin = origin === new URL(request.url).origin;
    if (origin && (origin === webOrigin(env) || sameOrigin)) {
      headers.set("access-control-allow-origin", origin);
      headers.set("access-control-allow-credentials", "true");
      headers.set("access-control-allow-headers", "authorization, content-type, x-requested-with");
      headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function sessionCookie(token: string, secure: boolean, maxAge: number): string {
  const parts = [`session=${token}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return sessionCookie("", secure, 0);
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return null;
}

export function csrfOk(request: Request, via: "bearer" | "session"): boolean {
  if (via === "bearer") {
    return true;
  }
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return true;
  }
  return request.headers.get("x-requested-with") === "folderlink";
}
