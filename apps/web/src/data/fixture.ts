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

const longPath =
  "~/projects/very-long-course-name/assignments/semester-three/data-structures-and-algorithms/project-final-submission/src";

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
        version: "v0.1.0",
        lastSeenAt: new Date().toISOString(),
        uptimeLabel: "2h 14m",
        latencyLabel: "38 ms",
        readsToday: 38,
        blocked: 1,
      },
    ],
    folders: [
      {
        id: "f1",
        label: "~/projects/raffle",
        approval: "approved",
        deviceName: "ThinkPad",
        detail: "142 files · 3 blocked by rules",
      },
      {
        id: "f2",
        label: "~/uni/dsa-assignment-3",
        approval: "approved",
        deviceName: "ThinkPad",
        detail: "27 files",
      },
      {
        id: "f3",
        label: longNames ? longPath : "~/projects/portfolio",
        approval: "revoked",
        deviceName: "ThinkPad",
        detail: "paused · hidden from AI",
      },
    ],
    apps: [
      { id: "gpt", name: "ChatGPT", mark: "GPT", tone: "gpt", detail: "oauth · last call 2m ago" },
      {
        id: "claude",
        name: "Claude",
        mark: "C",
        tone: "claude",
        detail: "oauth · last call yesterday",
      },
    ],
    activity: [
      {
        id: "a1",
        time: "14:32",
        action: "read",
        target: "raffle/src/draw.ts",
        detail: "",
        denied: false,
      },
      {
        id: "a2",
        time: "14:31",
        action: "grep",
        target: '"winner"',
        detail: "6 hits",
        denied: false,
      },
      {
        id: "a3",
        time: "14:31",
        action: "deny",
        target: "raffle/.env",
        detail: "secret",
        denied: true,
      },
      { id: "a4", time: "14:30", action: "ls", target: "raffle/src/", detail: "18", denied: false },
      {
        id: "a5",
        time: "14:02",
        action: "read",
        target: "dsa-assignment-3/heap.cpp",
        detail: "",
        denied: false,
      },
      {
        id: "a6",
        time: "14:01",
        action: "ls",
        target: "dsa-assignment-3/",
        detail: "27",
        denied: false,
      },
      {
        id: "a7",
        time: "yday",
        action: "read",
        target: "raffle/README.md",
        detail: "claude",
        denied: false,
      },
    ],
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
