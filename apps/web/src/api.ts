import type { PairPreview } from "./data/types.ts";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface AuthConfig {
  google: boolean;
  dev: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export interface Device {
  id: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  pairedAt: string | null;
  online: boolean;
  os: string;
  arch: string;
  version: string;
  fingerprint: string;
  network: string;
}

export interface Folder {
  id: string;
  label: string;
  approval: string;
  deviceId: string;
  deviceName: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) {
    headers.set("content-type", "application/json");
  }
  if (init.method && init.method !== "GET" && init.method !== "HEAD") {
    headers.set("x-requested-with", "folderlink");
  }
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    let message = response.statusText;
    let code = "";
    try {
      const body = (await response.json()) as { error?: { message?: string; code?: string } };
      if (body.error?.message) {
        message = body.error.message;
      }
      code = body.error?.code ?? "";
    } catch {
      // The body was not JSON.
    }
    throw new ApiError(message, response.status, code);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  config: () => request<AuthConfig>("/api/auth/config"),
  me: () => request<{ user: User }>("/api/me"),
  devSession: () => request<{ user: User }>("/api/dev/session", { method: "POST" }),
  logout: () => request<{ ok: boolean }>("/api/session/logout", { method: "POST" }),
  preview: (code: string) =>
    request<PairPreview>(`/api/pair/preview?code=${encodeURIComponent(code)}`),
  completePair: (code: string) =>
    request<{ deviceId: string; status: string }>("/api/pair/complete", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  devices: () => request<{ devices: Device[] }>("/api/devices"),
  folders: () => request<{ folders: Folder[] }>("/api/folders"),
  setApproval: (id: string, approval: "approved" | "revoked") =>
    request<{ ok: boolean }>(`/api/folders/${id}/approval`, {
      method: "POST",
      body: JSON.stringify({ approval }),
    }),
  revokeDevice: (id: string) =>
    request<{ ok: boolean }>(`/api/devices/${id}/revoke`, { method: "POST" }),
  renameDevice: (deviceId: string, name: string) =>
    request<{ ok: boolean; name: string }>(`/api/devices/${deviceId}/rename`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  pickFolder: (deviceId: string) =>
    request<{ id: string; label: string }>(`/api/devices/${deviceId}/folders/pick`, {
      method: "POST",
    }),
  renameFolder: (id: string, label: string) =>
    request<{ ok: boolean }>(`/api/folders/${id}/rename`, {
      method: "POST",
      body: JSON.stringify({ label }),
    }),
  removeFolder: (id: string) =>
    request<{ ok: boolean }>(`/api/folders/${id}/remove`, { method: "POST" }),
  apps: () =>
    request<{ apps: Array<{ id: string; name: string; scope: string; createdAt: string }> }>(
      "/api/apps",
    ),
  activity: () =>
    request<{
      activity: Array<{
        id: string;
        time: string;
        action: string;
        target: string;
        detail: string;
        denied: boolean;
      }>;
    }>("/api/activity"),
  revokeApp: (id: string) => request<{ ok: boolean }>(`/api/apps/${id}/revoke`, { method: "POST" }),
};
