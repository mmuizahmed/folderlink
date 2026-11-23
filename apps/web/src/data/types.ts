export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export interface DeviceView {
  id: string;
  name: string;
  status: string;
  online: boolean;
  os: string;
  arch: string;
  fingerprint: string;
  network: string;
  version: string;
  lastSeenAt: string | null;
  pairedAt: string | null;
}

export interface FolderView {
  id: string;
  label: string;
  approval: "pending" | "approved" | "revoked";
  deviceName: string;
  detail: string;
}

export interface AppView {
  id: string;
  name: string;
  mark: string;
  tone: "gpt" | "claude";
  detail: string;
}

export interface ActivityView {
  id: string;
  time: string;
  action: string;
  target: string;
  detail: string;
  denied: boolean;
}

export interface DashboardData {
  user: SessionUser;
  devices: DeviceView[];
  folders: FolderView[];
  apps: AppView[];
  activity: ActivityView[];
}

export interface PairPreview {
  name: string;
  status: string;
  os: string;
  arch: string;
  fingerprint: string;
  network: string;
  expiresAt: string;
  folders: string;
}

export type ViewState<T> =
  { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };
