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

// AppIdentity names the AI app behind a grant or an activity row, from
// the OAuth client's registered name as normalized by the worker. It is
// attribution only; authorization uses the grant id, never the name.
export type AppIdentity = "chatgpt" | "claude" | "muse" | "unknown";

export interface FolderView {
  id: string;
  label: string;
  approval: "pending" | "approved" | "revoked";
  deviceName: string;
  detail: string;
  // apps is null when the folder is unrestricted (every app may see it),
  // otherwise the ids of the apps allowed to see it.
  apps: string[] | null;
}

export interface AppView {
  id: string;
  name: string;
  identity: AppIdentity;
  mark: string;
  tone: "gpt" | "claude" | "muse" | "unknown";
  detail: string;
}

export interface ActivityView {
  id: string;
  time: string;
  action: string;
  target: string;
  detail: string;
  denied: boolean;
  // client is the app identity behind the call (chatgpt / claude / muse /
  // unknown), so the row can show that app's mark.
  client: AppIdentity;
}

// WriteApprovalMode is the user's write approval mode. "ai" (the
// default) means the connected app's own confirmation card gates normal
// writes, and dashboard pre-approval applies only to high-risk ops.
// "manual" means every write and exec needs the user's manual approval
// in the dashboard. The mode is the top authority: it takes priority
// over per-tool defaults and remember-rules.
export type WriteApprovalMode = "ai" | "manual";

export interface ApprovalView {
  id: string;
  tool: string;
  op: string;
  folderId: string;
  folderLabel: string;
  path: string;
  client: AppIdentity;
  contentHash: string;
  preHash: string;
  diff: string;
  preview: string;
  argv: string[];
  size: number;
  status: "pending" | "approved" | "denied" | "expired" | "executed" | "failed";
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  executedAt: string | null;
}

export interface DashboardData {
  user: SessionUser;
  devices: DeviceView[];
  folders: FolderView[];
  apps: AppView[];
  activity: ActivityView[];
  approvals: ApprovalView[];
  writeApprovalMode: WriteApprovalMode;
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
