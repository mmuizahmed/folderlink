import type { DashboardData, PairPreview, SessionUser } from "./types.ts";

export const fixtureUser: SessionUser = {
  id: "user-fixture",
  email: "muiz@example.com",
  name: "Muiz Ahmed",
};

export const fixturePreview: PairPreview = {
  name: "Muiz’s ThinkPad",
  status: "pending",
  os: "windows 11",
  arch: "amd64",
  fingerprint: "ed25519:9F3A…C21E",
  network: "39.45.x.x · Lahore, PK",
  expiresAt: new Date(Date.now() + (8 * 60 + 41) * 1000).toISOString(),
  folders: "none yet — you choose after pairing",
};

const longLabel = "very-long-course-name-assignments-semester-three-data-structures-and-algorithms";

export function fixtureDashboard(longNames = false): DashboardData {
  return {
    user: fixtureUser,
    devices: [
      {
        id: "device-thinkpad",
        name: longNames
          ? "Muiz’s ThinkPad with an unusually long hostname for truncation"
          : "Muiz’s ThinkPad",
        status: "active",
        online: true,
        os: "windows 11",
        arch: "amd64",
        fingerprint: "ed25519:9F3A…C21E",
        network: "39.45.x.x · Lahore, PK",
        version: "0.1.0",
        lastSeenAt: "2026-11-23T02:40:00.000Z",
        pairedAt: "2026-11-23T00:26:00.000Z",
      },
    ],
    folders: [
      {
        id: "f1",
        label: "raffle",
        approval: "approved",
        deviceName: "ThinkPad",
        detail: "read-only",
        apps: null,
      },
      {
        id: "f2",
        label: "dsa-assignment-3",
        approval: "approved",
        deviceName: "ThinkPad",
        detail: "read-only",
        apps: null,
      },
      {
        id: "f3",
        label: longNames ? longLabel : "portfolio",
        approval: "revoked",
        deviceName: "ThinkPad",
        detail: "paused · hidden from AI",
        apps: null,
      },
    ],
    apps: [
      {
        id: "gpt",
        name: "ChatGPT",
        identity: "chatgpt",
        mark: "GPT",
        tone: "gpt",
        detail: "Read-only",
      },
      {
        id: "claude",
        name: "Claude",
        identity: "claude",
        mark: "C",
        tone: "claude",
        detail: "Read-only",
      },
    ],
    activity: [
      {
        id: "a1",
        time: "2026-11-24T21:28:00.000Z",
        action: "read_file",
        target: "apps/web/src/pages/Dashboard.tsx",
        detail: "muse · ok",
        denied: false,
        client: "muse",
      },
      {
        id: "a2",
        time: "2026-11-24T21:28:00.000Z",
        action: "write_file",
        target: "apps/web/src/components",
        detail: "muse · ok",
        denied: false,
        client: "muse",
      },
      {
        id: "a3",
        time: "2026-11-24T21:27:00.000Z",
        action: "read_file",
        target: "apps/web/src/components",
        detail: "muse · ok",
        denied: false,
        client: "muse",
      },
      {
        id: "a4",
        time: "2026-11-24T21:26:00.000Z",
        action: "list_folders",
        target: "",
        detail: "muse · ok",
        denied: false,
        client: "muse",
      },
      {
        id: "a5",
        time: "2026-11-24T21:08:00.000Z",
        action: "read_file",
        target: "assignments/index.html",
        detail: "chatgpt · ok",
        denied: false,
        client: "chatgpt",
      },
      {
        id: "a6",
        time: "2026-11-24T21:08:00.000Z",
        action: "read_file",
        target: "assignments/index.html",
        detail: "chatgpt · ok",
        denied: false,
        client: "chatgpt",
      },
      {
        id: "a7",
        time: "2026-11-24T21:07:00.000Z",
        action: "list_files",
        target: "assignments",
        detail: "chatgpt · ok",
        denied: false,
        client: "chatgpt",
      },
      {
        id: "a8",
        time: "2026-11-24T21:02:00.000Z",
        action: "list_folders",
        target: "",
        detail: "chatgpt · ok",
        denied: false,
        client: "chatgpt",
      },
      {
        id: "a9",
        time: "2026-11-24T18:30:00.000Z",
        action: "search_files",
        target: "muiz-multisig-wallet",
        detail: "muse · ok",
        denied: false,
        client: "muse",
      },
      {
        id: "a10",
        time: "2026-11-24T18:30:00.000Z",
        action: "list_files",
        target: "muiz-multisig-wallet",
        detail: "muse · unavailable",
        denied: true,
        client: "muse",
      },
    ],
    approvals: [],
    writeApprovalMode: "ai",
  };
}

export function emptyDashboard(user: SessionUser): DashboardData {
  return {
    user,
    devices: [],
    folders: [],
    apps: [],
    activity: [],
    approvals: [],
    writeApprovalMode: "ai",
  };
}

export function offlineDashboard(): DashboardData {
  const data = fixtureDashboard();
  const device = data.devices[0];
  if (device) {
    device.online = false;
    device.status = "active";
  }
  return data;
}
