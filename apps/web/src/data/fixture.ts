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
      },
      {
        id: "f2",
        label: "dsa-assignment-3",
        approval: "approved",
        deviceName: "ThinkPad",
        detail: "read-only",
      },
      {
        id: "f3",
        label: longNames ? longLabel : "portfolio",
        approval: "revoked",
        deviceName: "ThinkPad",
        detail: "paused · hidden from AI",
      },
    ],
    apps: [
      { id: "gpt", name: "ChatGPT", mark: "GPT", tone: "gpt", detail: "Read-only" },
      {
        id: "claude",
        name: "Claude",
        mark: "C",
        tone: "claude",
        detail: "Read-only",
      },
    ],
    activity: [],
  };
}

export function emptyDashboard(user: SessionUser): DashboardData {
  return { user, devices: [], folders: [], apps: [], activity: [] };
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
