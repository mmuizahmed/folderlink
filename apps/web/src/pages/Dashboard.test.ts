import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActivityList,
  AppList,
  DiffView,
  FolderDetails,
  FolderSummary,
  SettingsSection,
} from "./Dashboard.tsx";
import type {
  ActivityView,
  AppView,
  DashboardData,
  FolderView,
  SessionUser,
} from "../data/types.ts";

const photoUser: SessionUser = {
  id: "u1",
  email: "muiz@example.com",
  name: "Muiz Ahmed",
  avatarUrl: "https://example.com/photo.jpg",
};
const plainUser: SessionUser = {
  id: "u1",
  email: "muiz@example.com",
  name: "Muiz Ahmed",
};

const apps: AppView[] = [
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
];

const activeFolder: FolderView = {
  id: "f1",
  label: "raffle",
  approval: "approved",
  deviceName: "ThinkPad",
  detail: "read-only",
  apps: null,
};
const pausedFolder: FolderView = {
  id: "f2",
  label: "portfolio",
  approval: "revoked",
  deviceName: "ThinkPad",
  detail: "paused · hidden from AI",
  apps: [],
};

function activity(id: string, action: string): ActivityView {
  return {
    id,
    time: "2026-11-24T21:28:00.000Z",
    action,
    target: "apps/web",
    detail: "muse · ok",
    denied: false,
    client: "muse",
  };
}

describe("SettingsSection", () => {
  it("shows the Google photo, name, and email when the user has a photo", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsSection, {
        user: photoUser,
        writeApprovalMode: "ai",
        modeNote: "",
        onSetMode: () => {},
        onLogout: () => {},
      }),
    );
    expect(html).toContain('<img class="avatar xl" src="https://example.com/photo.jpg"');
    expect(html).toContain("Muiz Ahmed");
    expect(html).toContain("muiz@example.com");
  });

  it("falls back to initials without a photo", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsSection, {
        user: plainUser,
        writeApprovalMode: "ai",
        modeNote: "",
        onSetMode: () => {},
        onLogout: () => {},
      }),
    );
    expect(html).toContain('<span class="avatar xl">MA</span>');
  });

  it("checks the radio that matches the mode and marks its option selected", () => {
    const ai = renderToStaticMarkup(
      createElement(SettingsSection, {
        user: plainUser,
        writeApprovalMode: "ai",
        modeNote: "",
        onSetMode: () => {},
        onLogout: () => {},
      }),
    );
    expect(ai.match(/checked=""/g)?.length).toBe(1);
    expect(ai).toContain('class="mode-option selected"');
    expect(ai).toContain("AI approval");
    expect(ai).toContain("Every write still needs your approval here in the dashboard.");

    const manual = renderToStaticMarkup(
      createElement(SettingsSection, {
        user: plainUser,
        writeApprovalMode: "manual",
        modeNote: "",
        onSetMode: () => {},
        onLogout: () => {},
      }),
    );
    expect(manual.match(/checked=""/g)?.length).toBe(1);
    expect(manual).toContain("Manual approval");
  });

  it("shows the save note and the session copy", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsSection, {
        user: plainUser,
        writeApprovalMode: "ai",
        modeNote: "Saved.",
        onSetMode: () => {},
        onLogout: () => {},
      }),
    );
    expect(html).toContain("Saved.");
    expect(html).toContain("Sign out");
    expect(html).toContain("signed in as muiz@example.com");
    expect(html).toContain("Signing out ends this browser session");
    expect(html).toContain("your folders and approvals stay");
  });
});

describe("AppList", () => {
  it("names all three apps in the empty state", () => {
    const html = renderToStaticMarkup(
      createElement(AppList, { apps: [], onRevoke: () => Promise.resolve() }),
    );
    expect(html).toContain("No connected apps");
    expect(html).toContain("Connect ChatGPT, Claude, or Muse to https://folderlink.muiz.pk/mcp.");
  });
});

describe("ActivityList", () => {
  const items = [
    activity("a1", "read_file"),
    activity("a2", "list_files"),
    activity("a3", "search_files"),
    activity("a4", "read_file"),
    activity("a5", "list_folders"),
  ];

  it("caps the preview at the limit and shows More when there are more rows", () => {
    const html = renderToStaticMarkup(
      createElement(ActivityList, { items, limit: 3, onShowAll: () => {} }),
    );
    expect(html).toContain("read_file");
    expect(html).toContain("list_files");
    expect(html).toContain("search_files");
    expect(html).not.toContain("list_folders");
    expect(html).toContain(">More<");
  });

  it("shows every row and no More button without a limit", () => {
    const html = renderToStaticMarkup(createElement(ActivityList, { items }));
    expect(html).toContain("list_folders");
    expect(html).not.toContain(">More<");
  });

  it("keeps the empty state when there is no activity", () => {
    const html = renderToStaticMarkup(createElement(ActivityList, { items: [] }));
    expect(html).toContain("No read log");
  });
});

describe("FolderSummary", () => {
  it("shows one row per folder, the count footer, and the active share", () => {
    const data = { folders: [activeFolder, pausedFolder], apps } as unknown as DashboardData;
    const html = renderToStaticMarkup(
      createElement(FolderSummary, { data, onShowFolders: () => {} }),
    );
    expect(html).toContain("2 folders · 1 active");
    expect(html).toContain("raffle");
    expect(html).toContain("portfolio");
    expect(html).toContain("read-only");
    expect(html).toContain("paused · hidden from AI");
    expect(html).toContain("Manage");
    expect(html).not.toContain("Rename");
    expect(html).not.toContain("Remove");
  });

  it("shows the empty state when there are no folders", () => {
    const data = { folders: [] } as unknown as DashboardData;
    const html = renderToStaticMarkup(
      createElement(FolderSummary, { data, onShowFolders: () => {} }),
    );
    expect(html).toContain("No folders");
  });
});

describe("FolderDetails", () => {
  const noop = () => Promise.resolve();

  it("shows the folder, its status, and the per-app chips", () => {
    const html = renderToStaticMarkup(
      createElement(FolderDetails, {
        folder: activeFolder,
        apps,
        onBack: () => {},
        onSetApps: noop,
        onToggle: noop,
        onRename: noop,
        onRemove: noop,
      }),
    );
    expect(html).toContain("raffle");
    expect(html).toContain(">active<");
    expect(html).toContain("Visible to all connected apps");
    expect(html).toContain("ChatGPT");
    expect(html).toContain("Claude");
    expect(html).toContain(">Pause<");
    expect(html).toContain("Rename");
    expect(html).toContain("Remove");
    expect(html).toContain("← Folders");
  });

  it("shows a paused folder and its restricted access", () => {
    const html = renderToStaticMarkup(
      createElement(FolderDetails, {
        folder: pausedFolder,
        apps,
        onBack: () => {},
        onSetApps: noop,
        onToggle: noop,
        onRename: noop,
        onRemove: noop,
      }),
    );
    expect(html).toContain("portfolio");
    expect(html).toContain(">paused<");
    expect(html).toContain(">Resume<");
    expect(html).toContain("Hidden from every app");
  });
});

describe("DiffView", () => {
  const diff = [
    "--- a/apps/web/src/data/fixture.ts",
    "+++ b/apps/web/src/data/fixture.ts",
    "@@ -83,7 +83,98 @@ fixture",
    '    detail: "Read-only",',
    "  },",
    "],",
    "-  activity: [],",
    "+  activity: [",
    "+    {",
    '+      id: "a1",',
    "",
  ].join("\n");

  it("renders a GitHub-style diff with no raw markers", () => {
    const html = renderToStaticMarkup(createElement(DiffView, { diff }));
    expect(html).not.toContain("--- a/");
    expect(html).not.toContain("+++ b/");
    expect(html).not.toContain("@@");
    expect(html).toContain("fixture");
    expect(html).toContain("diff-add");
    expect(html).toContain("diff-del");
    expect(html).toContain("activity: [");
    expect(html).toContain("activity: [],");
  });

  it("numbers the old and new sides", () => {
    const html = renderToStaticMarkup(createElement(DiffView, { diff }));
    // The removed line is old 86 with no new number; the first added
    // line is new 86 with no old number; the context line above them
    // is 83 on both sides.
    expect(html).toContain('<span class="diff-no">86</span><span class="diff-no"></span>');
    expect(html).toContain('<span class="diff-no"></span><span class="diff-no">86</span>');
    expect(html).toContain('<span class="diff-no">83</span><span class="diff-no">83</span>');
  });

  it("shows the hunk section text, or an ellipsis when there is none", () => {
    const html = renderToStaticMarkup(createElement(DiffView, { diff }));
    expect(html).toContain('<div class="diff-hunk">fixture</div>');
    const plain = renderToStaticMarkup(
      createElement(DiffView, {
        diff: "@@ -1,2 +1,2 @@\n context\n-old\n+new\n",
      }),
    );
    expect(plain).toContain('<div class="diff-hunk">···</div>');
  });
});
