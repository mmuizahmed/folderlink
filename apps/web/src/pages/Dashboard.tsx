import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { api, ApiError, type Device, type Folder } from "../api.ts";
import { downloadForThisComputer } from "../downloads.ts";
import { usePageTitle } from "../session.ts";
import {
  IconActivity,
  IconApps,
  IconFolder,
  IconGrid,
  IconLaptop,
  IconSettings,
  IconShield,
  Mark,
} from "../components/Icons.tsx";
import { Avatar } from "../components/AccountMenu.tsx";
import { screenMode } from "../data/mode.ts";
import type {
  ActivityView,
  AppIdentity,
  ApprovalView,
  AppView,
  DashboardData,
  FolderView,
  SessionUser,
  ViewState,
  WriteApprovalMode,
} from "../data/types.ts";
import {
  identityFromServer,
  logoForIdentity,
  markForIdentity,
  toneForIdentity,
} from "../data/apps.ts";

type Section = "overview" | "devices" | "folders" | "approvals" | "apps" | "activity" | "settings";

const NAV: Array<{
  id: Section;
  label: string;
  icon: ReactNode;
  count?: "devices" | "folders" | "apps" | "approvals";
}> = [
  { id: "overview", label: "Overview", icon: <IconGrid /> },
  { id: "folders", label: "Folders", icon: <IconFolder />, count: "folders" },
  {
    id: "approvals",
    label: "Approvals",
    icon: <IconShield />,
    count: "approvals",
  },
  { id: "activity", label: "Activity", icon: <IconActivity /> },
  { id: "apps", label: "AI apps", icon: <IconApps />, count: "apps" },
  {
    id: "devices",
    label: "Devices",
    icon: <IconLaptop width="15" height="15" />,
    count: "devices",
  },
  { id: "settings", label: "Settings", icon: <IconSettings /> },
];

// AppMark shows the app's real brand logo when one is bundled, and the
// neutral letter fallback otherwise. The logo fills the chip; the Claude
// mark is inverted to white on the coral chip (see logoForIdentity).
function AppMark({ identity, small }: { identity: AppIdentity; small?: boolean }) {
  const logo = logoForIdentity(identity);
  return (
    <span
      className={`app-mark ${toneForIdentity(identity)}${small ? " small" : ""}`}
      title={identity}
    >
      {logo ? (
        <img src={logo.src} alt={identity} className={logo.invert ? "invert" : undefined} />
      ) : (
        markForIdentity(identity)
      )}
    </span>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const mode = screenMode();
  const [section, setSection] = useState<Section>("overview");
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [state, setState] = useState<ViewState<DashboardData>>({ status: "loading" });
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  // busy is the approval being decided right now; modeNote is the
  // save feedback for the write approval setting.
  const [busy, setBusy] = useState<string | null>(null);
  const [modeNote, setModeNote] = useState("");
  usePageTitle("Dashboard · FolderLink");

  // A dashboard link from the bridge (or the AI) lands on
  // #approvals[/id]: open the Approvals section.
  useEffect(() => {
    if (window.location.hash.startsWith("#approvals")) {
      setSection("approvals");
    }
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV && mode !== "live") {
      let gone = false;
      void (async () => {
        const preview = await import("../data/fixture.ts");
        if (gone) return;
        if (mode === "loading") {
          setState({ status: "loading" });
          return;
        }
        if (mode === "error") {
          setState({ status: "error", message: "The control service is not reachable." });
          return;
        }
        if (mode === "fixture" || mode === "long") {
          setState({ status: "ready", data: preview.fixtureDashboard(mode === "long") });
          return;
        }
        if (mode === "offline") {
          setState({ status: "ready", data: preview.offlineDashboard() });
          return;
        }
        if (mode === "empty") {
          setState({ status: "ready", data: preview.emptyDashboard(preview.fixtureUser) });
        }
      })();
      return () => {
        gone = true;
      };
    }
    let gone = false;
    async function load() {
      try {
        const me = await api.me();
        const [devices, folders, apps, activity, settingsRes, approvalsRes] = await Promise.all([
          api.devices(),
          api.folders(),
          api.apps().catch(() => ({
            apps: [] as Array<{ id: string; name: string; identity: string }>,
          })),
          api.activity().catch(() => ({ activity: [] as DashboardData["activity"] })),
          api.settings().catch(() => ({ writeApprovalMode: "ai" })),
          api.approvals().catch(() => ({ approvals: [] as DashboardData["approvals"] })),
        ]);
        if (gone) return;
        const data: DashboardData = {
          user: me.user,
          devices: devices.devices.map(toDevice),
          folders: folders.folders.map(toFolder),
          apps: apps.apps.map((app) => {
            const identity = identityFromServer(app.identity);
            return {
              id: app.id,
              name: app.name,
              identity,
              mark: markForIdentity(identity),
              tone: toneForIdentity(identity),
              detail: "Read-only",
            };
          }),
          activity: activity.activity.map((item) => ({
            ...item,
            client: identityFromServer(item.client),
          })),
          approvals: approvalsRes.approvals.map(toApproval),
          writeApprovalMode: settingsRes.writeApprovalMode === "manual" ? "manual" : "ai",
        };
        setState({ status: "ready", data });
      } catch (err) {
        if (gone) return;
        if (err instanceof ApiError && err.status === 401) {
          navigate("/pair");
          return;
        }
        setState({
          status: "error",
          message: err instanceof ApiError ? err.message : "The control service is not reachable.",
        });
      }
    }
    void load();
    return () => {
      gone = true;
    };
  }, [mode, navigate]);

  async function toggleFolder(folder: FolderView) {
    if (state.status !== "ready") return;
    const next = folder.approval === "approved" ? "revoked" : "approved";
    if (mode === "live") await api.setApproval(folder.id, next);
    setState({
      status: "ready",
      data: {
        ...state.data,
        folders: state.data.folders.map((item) =>
          item.id === folder.id
            ? {
                ...item,
                approval: next,
                detail: next === "approved" ? "read-only" : "paused · hidden from AI",
              }
            : item,
        ),
      },
    });
  }

  async function removeDevice(id: string) {
    if (state.status !== "ready") return;
    if (mode === "live") await api.revokeDevice(id);
    setState({
      status: "ready",
      data: {
        ...state.data,
        devices: state.data.devices.map((device) =>
          device.id === id ? { ...device, status: "revoked", online: false } : device,
        ),
      },
    });
  }

  async function logout() {
    if (mode === "live") await api.logout();
    navigate("/");
  }

  async function renameDevice(id: string, name: string) {
    if (state.status !== "ready") return;
    if (mode === "live") {
      await api.renameDevice(id, name);
    }
    setState({
      status: "ready",
      data: {
        ...state.data,
        devices: state.data.devices.map((device) =>
          device.id === id ? { ...device, name } : device,
        ),
      },
    });
  }

  async function addFolder() {
    if (state.status !== "ready") return;
    const device = state.data.devices.find((item) => item.online && item.status === "active");
    if (!device) {
      setNotice("Open FolderLink on your computer, then add a folder.");
      return;
    }
    if (mode !== "live") {
      setNotice("The folder picker runs on your computer.");
      return;
    }
    setAdding(true);
    setNotice("Choose a folder in the window on this computer.");
    try {
      const picked = await api.pickFolder(device.id);
      setNotice(`Added ${picked.label}.`);
      setState({
        status: "ready",
        data: {
          ...state.data,
          folders: [
            ...state.data.folders,
            {
              id: picked.id,
              label: picked.label,
              approval: "approved",
              deviceName: device.name,
              detail: "read-only",
              apps: null,
            },
          ],
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "canceled") {
        setNotice("No folder was selected.");
      } else {
        setNotice(err instanceof ApiError ? err.message : "The folder could not be added.");
      }
    } finally {
      setAdding(false);
    }
  }

  async function renameFolder(id: string, label: string) {
    if (state.status !== "ready") return;
    try {
      if (mode === "live") await api.renameFolder(id, label);
      setNotice("");
      setState({
        status: "ready",
        data: {
          ...state.data,
          folders: state.data.folders.map((folder) =>
            folder.id === id ? { ...folder, label } : folder,
          ),
        },
      });
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "The folder could not be renamed.");
    }
  }

  async function removeFolder(id: string) {
    if (state.status !== "ready") return;
    try {
      if (mode === "live") await api.removeFolder(id);
      setNotice("");
      setState({
        status: "ready",
        data: {
          ...state.data,
          folders: state.data.folders.filter((folder) => folder.id !== id),
        },
      });
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "The folder could not be removed.");
    }
  }

  async function revokeApp(id: string) {
    if (state.status !== "ready") return;
    try {
      if (mode === "live") await api.revokeApp(id);
      setState({
        status: "ready",
        data: {
          ...state.data,
          apps: state.data.apps.filter((app) => app.id !== id),
        },
      });
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "The app could not be disconnected.");
    }
  }

  // setFolderApps replaces the allowed-apps list for one folder: null is
  // unrestricted (every app may see it), [] hides it from every app.
  async function setFolderApps(id: string, apps: string[] | null) {
    if (state.status !== "ready") return;
    try {
      if (mode === "live") await api.setFolderApps(id, apps);
      setState({
        status: "ready",
        data: {
          ...state.data,
          folders: state.data.folders.map((folder) =>
            folder.id === id ? { ...folder, apps } : folder,
          ),
        },
      });
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "The folder access could not be saved.");
    }
  }

  // decideApproval approves or denies one pending request. The worker
  // asks the bridge over the websocket; the row only changes when the
  // bridge confirms, so a decision here never outruns the device.
  async function decideApproval(id: string, approve: boolean) {
    if (state.status !== "ready" || busy) return;
    setBusy(id);
    try {
      if (mode === "live") {
        if (approve) {
          await api.approveApproval(id);
        } else {
          await api.denyApproval(id);
        }
      }
      setState({
        status: "ready",
        data: {
          ...state.data,
          approvals: state.data.approvals.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: approve ? "approved" : "denied",
                  decidedAt: new Date().toISOString(),
                }
              : item,
          ),
        },
      });
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "The approval could not be decided.");
    } finally {
      setBusy(null);
    }
  }

  // setWriteApprovalMode changes the write approval mode. It is the top
  // rule: in manual mode every write and exec needs an approval here,
  // and neither a client card nor a remember-rule bypasses it.
  async function setWriteApprovalMode(modeValue: WriteApprovalMode) {
    if (state.status !== "ready") return;
    setModeNote("");
    try {
      if (mode === "live") await api.setWriteApprovalMode(modeValue);
      setState({
        status: "ready",
        data: { ...state.data, writeApprovalMode: modeValue },
      });
      setModeNote("Saved.");
    } catch (err) {
      setModeNote(err instanceof ApiError ? err.message : "The setting could not be saved.");
    }
  }

  // Approvals and folders are polled every 30s while the dashboard is
  // open, so a request the AI just made — or a folder just shared from
  // Explorer — shows up without a reload. The bridge re-hellos on its
  // own when a folder is added, so the folder is in the next poll at
  // most ~30s after the right-click. Best effort: a failed poll stays
  // quiet and the next one retries.
  useEffect(() => {
    if (mode !== "live" || state.status !== "ready") return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const [res, foldersRes] = await Promise.all([api.approvals(), api.folders()]);
          setState((prev) => {
            if (prev.status !== "ready") return prev;
            return {
              status: "ready",
              data: {
                ...prev.data,
                approvals: res.approvals.map(toApproval),
                folders: foldersRes.folders.map(toFolder),
              },
            };
          });
        } catch {
          // Stay quiet; the next poll retries.
        }
      })();
    }, 30_000);
    return () => clearInterval(timer);
  }, [mode, state.status]);

  const ready = state.status === "ready" ? state.data : null;
  const openFolder = ready?.folders.find((folder) => folder.id === openFolderId) ?? null;
  const pendingCount = ready
    ? ready.approvals.filter((item) => item.status === "pending").length
    : 0;
  const bridgeOnline = ready
    ? ready.devices.some((device) => device.online && device.status === "active")
    : false;

  return (
    <div className="shell">
      {menu ? (
        <button
          type="button"
          className="backdrop"
          aria-label="Close menu"
          onClick={() => setMenu(false)}
        />
      ) : null}
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <div className="side-brand">
          <Mark />
        </div>
        <nav className="side-nav" aria-label="Dashboard">
          {NAV.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={section === item.id ? "active" : undefined}
              onClick={(event) => {
                event.preventDefault();
                setSection(item.id);
                setOpenFolderId(null);
                setMenu(false);
              }}
            >
              {item.icon}
              {item.label}
              {item.count === "approvals" && pendingCount > 0 ? (
                <span className="count alert">{pendingCount}</span>
              ) : item.count && item.count !== "approvals" && ready ? (
                <span className="count">{ready[item.count].length}</span>
              ) : null}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <div className={bridgeOnline ? "bridge-status" : "bridge-status off"}>
            <i aria-hidden="true" />
            {bridgeOnline ? "Bridge connected" : "Bridge offline"}
          </div>
          {ready ? (
            <div className="account">
              <Avatar user={ready.user} className="lg" />
              <div>
                <div className="who-name">{ready.user.name || ready.user.email}</div>
                <div className="who-mail path">{ready.user.email}</div>
              </div>
            </div>
          ) : null}
        </div>
      </aside>
      <div className="main">
        <header className="dash-top">
          <button type="button" className="btn quiet small menu" onClick={() => setMenu(true)}>
            Menu
          </button>
          <div className="dash-title">{NAV.find((item) => item.id === section)?.label}</div>
          {ready && section === "overview" ? (
            <span className="dash-sub">
              {ready.folders.length} folder{ready.folders.length === 1 ? "" : "s"} shared ·{" "}
              {ready.apps.length} app{ready.apps.length === 1 ? "" : "s"} connected
            </span>
          ) : null}
        </header>
        <div className="dash-body">
          {state.status === "loading" ? <p className="state">Loading.</p> : null}
          {state.status === "error" ? (
            <p className="state" role="alert">
              <strong>Could not load this view</strong>
              {state.message}
            </p>
          ) : null}
          {ready && section === "overview" ? (
            <Overview
              data={ready}
              busy={busy}
              onDecide={decideApproval}
              onRemove={removeDevice}
              onRename={renameDevice}
              onAdd={addFolder}
              adding={adding}
              onRevoke={revokeApp}
              onShowApprovals={() => setSection("approvals")}
              onShowFolders={() => setSection("folders")}
              onShowActivity={() => setSection("activity")}
            />
          ) : null}
          {ready && section === "devices" ? (
            <DeviceList
              data={ready}
              pairHref={mode === "live" ? "/pair" : "/pair?fixture=1"}
              onRemove={removeDevice}
              onRename={renameDevice}
            />
          ) : null}
          {ready && section === "folders" ? (
            openFolder ? (
              <FolderDetails
                folder={openFolder}
                apps={ready.apps}
                onBack={() => setOpenFolderId(null)}
                onSetApps={setFolderApps}
                onToggle={toggleFolder}
                onRename={renameFolder}
                onRemove={removeFolder}
              />
            ) : (
              <FolderList
                data={ready}
                onToggle={toggleFolder}
                onAdd={addFolder}
                adding={adding}
                onRename={renameFolder}
                onRemove={removeFolder}
                onOpen={(folder) => setOpenFolderId(folder.id)}
                notice={notice}
              />
            )
          ) : null}
          {ready && section === "apps" ? <AppList apps={ready.apps} onRevoke={revokeApp} /> : null}
          {ready && section === "approvals" ? (
            <ApprovalsList items={ready.approvals} busy={busy} onDecide={decideApproval} />
          ) : null}
          {ready && section === "activity" ? <ActivityList items={ready.activity} /> : null}
          {ready && section === "settings" ? (
            <SettingsSection
              user={ready.user}
              writeApprovalMode={ready.writeApprovalMode}
              modeNote={modeNote}
              onSetMode={(modeValue) => void setWriteApprovalMode(modeValue)}
              onLogout={() => void logout()}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function SettingsSection({
  user,
  writeApprovalMode,
  modeNote,
  onSetMode,
  onLogout,
}: {
  user: SessionUser;
  writeApprovalMode: WriteApprovalMode;
  modeNote: string;
  onSetMode: (mode: WriteApprovalMode) => void;
  onLogout: () => void;
}) {
  return (
    <section className="settings-stack">
      <div className="section-head">
        <h2>Settings</h2>
      </div>
      <div className="profile-card edge">
        <Avatar user={user} className="xl" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="profile-name">{user.name || user.email}</div>
          <div className="minor path">{user.email}</div>
        </div>
      </div>
      <div className="mode-block edge">
        <div className="mode-head">
          <h3>Write approval</h3>
          {modeNote ? (
            <span className="minor" role="status">
              {modeNote}
            </span>
          ) : null}
        </div>
        <p className="minor">
          Who approves a write or a command before it runs. This is the top rule: it beats per-tool
          defaults and remember-rules.
        </p>
        <label className={writeApprovalMode === "ai" ? "mode-option selected" : "mode-option"}>
          <input
            type="radio"
            name="write-approval"
            checked={writeApprovalMode === "ai"}
            onChange={() => onSetMode("ai")}
          />
          <span>
            <strong>AI approval</strong>
            <span className="minor">
              The connected app asks you in chat first. Every write still needs your approval here
              in the dashboard.
            </span>
          </span>
        </label>
        <label className={writeApprovalMode === "manual" ? "mode-option selected" : "mode-option"}>
          <input
            type="radio"
            name="write-approval"
            checked={writeApprovalMode === "manual"}
            onChange={() => onSetMode("manual")}
          />
          <span>
            <strong>Manual approval</strong>
            <span className="minor">
              Every write and command needs your approval here in the dashboard. The tray shows a
              notification when one is waiting.
            </span>
          </span>
        </label>
      </div>
      <div className="session-card edge">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>Session</h3>
          <p className="minor">
            You&apos;re signed in as {user.email}. Signing out ends this browser session — your
            folders and approvals stay.
          </p>
        </div>
        <button type="button" className="btn quiet small" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </section>
  );
}

function Overview({
  data,
  busy,
  onDecide,
  onRemove,
  onRename,
  onAdd,
  adding,
  onRevoke,
  onShowApprovals,
  onShowFolders,
  onShowActivity,
}: {
  data: DashboardData;
  busy: string | null;
  onDecide: (id: string, approve: boolean) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onAdd: () => Promise<void>;
  adding: boolean;
  onRevoke: (id: string) => Promise<void>;
  onShowApprovals: () => void;
  onShowFolders: () => void;
  onShowActivity: () => void;
}) {
  const device = data.devices[0];
  const pending = data.approvals.filter((item) => item.status === "pending");
  const firstPending = pending[0];
  return (
    <>
      {pending.length > 0 ? (
        <section className="overview-approvals" aria-label="Approvals waiting">
          <div className="section-head">
            <h2>Approvals</h2>
            <button type="button" className="btn quiet small" onClick={onShowApprovals}>
              Review{pending.length > 1 ? ` ${pending.length}` : ""}
            </button>
          </div>
          {firstPending ? (
            <ApprovalCard item={firstPending} busy={busy} onDecide={onDecide} />
          ) : null}
          {pending.length > 1 ? (
            <p className="minor overview-more">
              {pending.length - 1} more waiting —{" "}
              <a
                href="#approvals"
                onClick={(event) => {
                  event.preventDefault();
                  onShowApprovals();
                }}
              >
                review all
              </a>
            </p>
          ) : null}
        </section>
      ) : null}
      <Checklist data={data} onAdd={onAdd} adding={adding} />
      <div className="split">
        <div>
          {device ? (
            <DeviceCard device={device} onRemove={onRemove} onRename={onRename} />
          ) : (
            <div className="state">
              <strong>No device yet</strong>
              Open FolderLink. It connects automatically.
            </div>
          )}
          <FolderSummary data={data} onShowFolders={onShowFolders} />
          <AppList apps={data.apps} onRevoke={onRevoke} />
        </div>
        <ActivityList items={data.activity} limit={8} onShowAll={onShowActivity} />
      </div>
    </>
  );
}

const MCP_URL = "https://folderlink.muiz.pk/mcp";

function Checklist({
  data,
  onAdd,
  adding,
}: {
  data: DashboardData;
  onAdd: () => Promise<void>;
  adding: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const download = downloadForThisComputer();
  const hasDevice = data.devices.some((device) => device.status !== "revoked");
  const connected = data.devices.some((device) => device.online && device.status === "active");
  const hasFolder = data.folders.some((folder) => folder.approval === "approved");
  const hasApp = data.apps.length > 0;
  const steps = [
    { done: hasDevice, title: "Download FolderLink", body: "Open it. It connects automatically." },
    {
      done: connected,
      title: "This computer is connected",
      body: "It runs in the system tray — click the icon for status.",
    },
    { done: hasFolder, title: "Add a folder", body: "The path stays on this computer." },
    {
      done: hasApp,
      title: "Connect ChatGPT, Claude, or Muse",
      body: "Add this address as a custom connector.",
    },
  ];
  // Once setup is done the card goes away: it is only guidance for getting
  // started. It comes back on its own if setup regresses (a device is
  // revoked, the last folder is removed, the last app is revoked), because
  // completion is recomputed from the live data on every render.
  if (steps.every((step) => step.done)) {
    return null;
  }
  return (
    <section className="checklist edge" aria-label="Getting started">
      <h2>Getting started</h2>
      <ol>
        {steps.map((step, index) => (
          <li key={step.title} className={step.done ? "done" : undefined}>
            <span className="step-no">{step.done ? "✓" : index + 1}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
              {index === 0 && !hasDevice ? (
                <a className="btn small" href={download.href}>
                  {download.label}
                </a>
              ) : null}
              {index === 2 && !hasFolder ? (
                <button
                  type="button"
                  className="btn small"
                  disabled={adding}
                  onClick={() => void onAdd()}
                >
                  {adding ? "Choosing a folder…" : "Add folder"}
                </button>
              ) : null}
              {index === 3 ? (
                <div className="copy-line">
                  <code>{MCP_URL}</code>
                  <button
                    type="button"
                    className="btn quiet small"
                    onClick={() => {
                      void navigator.clipboard.writeText(MCP_URL).then(() => {
                        setCopied(true);
                      });
                    }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DeviceCard({
  device,
  onRemove,
  onRename,
}: {
  device: DashboardData["devices"][number];
  onRemove: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
}) {
  const label = device.status === "revoked" ? "revoked" : device.online ? "online" : "offline";
  return (
    <section className="stat-card edge" aria-label="Selected device">
      <div className="stat-head">
        <div className="laptop edge">
          <IconLaptop />
          <span
            className={device.online && device.status !== "revoked" ? "presence on" : "presence"}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="device-title">
            <span className="path" title={device.name}>
              {device.name}
            </span>
            <span className={device.online && device.status !== "revoked" ? "badge go" : "badge"}>
              {label}
            </span>
          </div>
          <div className="device-sub path">
            {device.os || "unknown"} · {device.arch || "unknown"}
            {device.version ? ` · FolderLink ${device.version}` : ""}
          </div>
        </div>
        <div className="stat-actions">
          <button
            type="button"
            className="btn quiet small"
            onClick={() => {
              const name = window.prompt("Name this computer", device.name);
              if (name && name.trim()) {
                void onRename(device.id, name.trim());
              }
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="btn danger small"
            onClick={() => void onRemove(device.id)}
          >
            Remove
          </button>
        </div>
      </div>
      <dl className="facts">
        <dt>Last seen</dt>
        <dd>{device.online ? "Online now" : when(device.lastSeenAt)}</dd>
        <dt>Connected since</dt>
        <dd>{when(device.pairedAt)}</dd>
      </dl>
    </section>
  );
}

// when renders an absolute time in the viewer's own timezone, not the
// server's. The server stores UTC; the browser converts it. The locale
// stays en-US so the format (Nov 23, 9:40 PM) never changes — only the
// timezone follows the person looking at the page.
function when(value: string | null): string {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not yet";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function DeviceList({
  data,
  pairHref,
  onRemove,
  onRename,
}: {
  data: DashboardData;
  pairHref: string;
  onRemove: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
}) {
  return (
    <div>
      <div className="section-head">
        <h2>Devices</h2>
        <NavLink className="btn small" to={pairHref}>
          + Pair device
        </NavLink>
      </div>
      {data.devices.length === 0 ? (
        <Empty
          title="No devices"
          body="Download FolderLink and open it. It connects automatically."
        />
      ) : (
        data.devices.map((device) => (
          <div key={device.id} style={{ marginBottom: 16 }}>
            <DeviceCard device={device} onRemove={onRemove} onRename={onRename} />
          </div>
        ))
      )}
    </div>
  );
}

function FolderList({
  data,
  onToggle,
  onAdd,
  adding,
  onRename,
  onRemove,
  onOpen,
  notice,
}: {
  data: DashboardData;
  onToggle: (folder: FolderView) => Promise<void>;
  onAdd: () => Promise<void>;
  adding: boolean;
  onRename: (id: string, label: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onOpen: (folder: FolderView) => void;
  notice: string;
}) {
  return (
    <section>
      <div className="section-head">
        <h2>Folders</h2>
        <button type="button" className="btn small" disabled={adding} onClick={() => void onAdd()}>
          {adding ? "Choosing a folder…" : "Add folder"}
        </button>
      </div>
      <div className="list edge">
        {notice ? (
          <p
            className={
              notice.startsWith("Added ") ||
              notice.startsWith("Choose ") ||
              notice.startsWith("No folder")
                ? "match"
                : "alert"
            }
            role="status"
          >
            {notice}
          </p>
        ) : null}
        {data.folders.length === 0 ? (
          <Empty title="No folders" body="Add a folder from this computer. The path stays on it." />
        ) : null}
        {data.folders.map((folder) => {
          const on = folder.approval === "approved";
          return (
            <div className={on ? "folder-row" : "folder-row paused"} key={folder.id}>
              <span className="folder-icon" aria-hidden="true">
                <IconFolder />
              </span>
              <button
                type="button"
                className="folder-main folder-open"
                onClick={() => onOpen(folder)}
                aria-label={`Open details for ${folder.label}`}
              >
                <div className={on ? "path" : "path paused"} title={folder.label}>
                  {folder.label}
                </div>
                <div className="minor">
                  {folder.deviceName ? `${folder.detail} · ${folder.deviceName}` : folder.detail}
                </div>
              </button>
              <span className={on ? "tag" : "tag dim"}>read-only</span>
              <button
                type="button"
                className={on ? "toggle on" : "toggle"}
                aria-pressed={on}
                aria-label={`${on ? "Pause" : "Allow"} ${folder.label}`}
                title={on ? "Pause this folder (hide it from AI)" : "Allow this folder again"}
                onClick={() => void onToggle(folder)}
              />
              <span className="row-actions">
                <button
                  type="button"
                  className="btn quiet small"
                  onClick={() => {
                    const label = window.prompt("Rename this folder", folder.label);
                    if (label?.trim()) void onRename(folder.id, label.trim());
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="btn danger small"
                  onClick={() => void onRemove(folder.id)}
                >
                  Remove
                </button>
              </span>
            </div>
          );
        })}
        <div className="blocked-note">
          Secrets such as .env files, keys, and certificates are never sent.
        </div>
      </div>
    </section>
  );
}

// FolderSummary is the overview's compact folders card: one row per
// folder — a live dot, the name, its detail — with the app marks it is
// shared with, and the count footer. The full list lives in the Folders
// section; this card never grows rows with actions, so it never shows
// Rename or Remove.
export function FolderSummary({
  data,
  onShowFolders,
}: {
  data: DashboardData;
  onShowFolders: () => void;
}) {
  const active = data.folders.filter((folder) => folder.approval === "approved").length;
  return (
    <section>
      <div className="section-head">
        <h2>Folders</h2>
        <button type="button" className="btn quiet small" onClick={onShowFolders}>
          Manage
        </button>
      </div>
      <div className="list edge">
        {data.folders.length === 0 ? (
          <Empty title="No folders" body="Add a folder from this computer. The path stays on it." />
        ) : (
          <>
            {data.folders.map((folder) => {
              const on = folder.approval === "approved";
              const allowed = on
                ? folder.apps === null
                  ? data.apps
                  : data.apps.filter((app) => folder.apps?.includes(app.id))
                : [];
              return (
                <div className="app-row" key={folder.id}>
                  <span className={on ? "ov-dot" : "ov-dot paused"} aria-hidden="true" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className={on ? "path" : "path paused"} title={folder.label}>
                      {folder.label}
                    </div>
                    <div className="minor">
                      {folder.deviceName
                        ? `${folder.detail} · ${folder.deviceName}`
                        : folder.detail}
                    </div>
                  </div>
                  <span className="ov-apps">
                    {allowed.map((app) => (
                      <AppMark key={app.id} identity={app.identity} small />
                    ))}
                  </span>
                </div>
              );
            })}
            <div className="blocked-note">
              {data.folders.length} folder{data.folders.length === 1 ? "" : "s"} · {active} active
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// FolderDetails is a folder's own page inside the Folders section: its
// status, device, and per-app access, plus the actions that used to sit on
// the row. The per-app chips moved here from the old Folder access table.
export function FolderDetails({
  folder,
  apps,
  onBack,
  onSetApps,
  onToggle,
  onRename,
  onRemove,
}: {
  folder: FolderView;
  apps: AppView[];
  onBack: () => void;
  onSetApps: (id: string, apps: string[] | null) => Promise<void>;
  onToggle: (folder: FolderView) => Promise<void>;
  onRename: (id: string, label: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const on = folder.approval === "approved";
  return (
    <section className="settings-stack">
      <div className="section-head">
        <button type="button" className="btn quiet small" onClick={onBack}>
          ← Folders
        </button>
      </div>
      <div className="profile-card edge">
        <span className="folder-icon xl" aria-hidden="true">
          <IconFolder />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="profile-name">{folder.label}</div>
          <div className="minor">
            {folder.deviceName ? `${folder.detail} · ${folder.deviceName}` : folder.detail}
          </div>
        </div>
        <span className={on ? "tag" : "tag dim"}>{on ? "active" : "paused"}</span>
      </div>
      <div className="mode-block edge">
        <div className="mode-head">
          <h3>AI apps</h3>
        </div>
        <p className="minor">{accessSummary(folder, apps)}</p>
        {apps.length === 0 ? (
          <p className="minor">
            No apps connected yet. Connect one first — until then every folder stays visible to
            every app.
          </p>
        ) : (
          <div className="access-chips">
            {apps.map((app) => {
              const allowed = folder.apps === null || folder.apps.includes(app.id);
              return (
                <button
                  key={app.id}
                  type="button"
                  className={allowed ? "access-chip on" : "access-chip"}
                  aria-pressed={allowed}
                  aria-label={`${allowed ? "Hide" : "Show"} ${folder.label} ${allowed ? "from" : "to"} ${app.name}`}
                  onClick={() => void onSetApps(folder.id, nextApps(folder, app.id, apps))}
                >
                  <AppMark identity={app.identity} small />
                  {app.name}
                  {allowed ? (
                    <span className="check" aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="session-card edge">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>Actions</h3>
          <p className="minor">
            Pausing hides this folder from every AI app. Removing it stops sharing it entirely.
          </p>
        </div>
        <span className="row-actions">
          <button
            type="button"
            className="btn quiet small"
            aria-label={`${on ? "Pause" : "Allow"} ${folder.label}`}
            title={on ? "Pause this folder (hide it from AI)" : "Allow this folder again"}
            onClick={() => void onToggle(folder)}
          >
            {on ? "Pause" : "Resume"}
          </button>
          <button
            type="button"
            className="btn quiet small"
            onClick={() => {
              const label = window.prompt("Rename this folder", folder.label);
              if (label?.trim()) void onRename(folder.id, label.trim());
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="btn danger small"
            onClick={() => {
              if (
                window.confirm(
                  `Remove "${folder.label}"? It will stop being shared with every AI app.`,
                )
              ) {
                void onRemove(folder.id);
              }
            }}
          >
            Remove
          </button>
        </span>
      </div>
    </section>
  );
}

// nextApps computes the folder's new allowed-apps list after toggling one
// app. Checking the last unchecked app clears the restriction (null),
// which is the canonical "every app" state.
function nextApps(folder: FolderView, toggledId: string, allApps: AppView[]): string[] | null {
  const current = folder.apps ?? allApps.map((app) => app.id);
  const next = current.includes(toggledId)
    ? current.filter((id) => id !== toggledId)
    : [...current, toggledId];
  if (next.length === allApps.length) {
    return null;
  }
  return next;
}

function accessSummary(folder: FolderView, apps: AppView[]): string {
  if (folder.apps === null) {
    return "Visible to all connected apps";
  }
  if (folder.apps.length === 0) {
    return "Hidden from every app";
  }
  const names = apps.filter((app) => folder.apps?.includes(app.id)).map((app) => app.name);
  return `Visible to: ${names.join(", ")}`;
}

export function AppList({
  apps,
  onRevoke,
}: {
  apps: AppView[];
  onRevoke: (id: string) => Promise<void>;
}) {
  return (
    <section>
      <div className="section-head">
        <h2>AI apps</h2>
      </div>
      <div className="list edge">
        {apps.length === 0 ? (
          <Empty
            title="No connected apps"
            body="Connect ChatGPT, Claude, or Muse to https://folderlink.muiz.pk/mcp. An app shows up here after you allow it."
          />
        ) : (
          apps.map((app) => (
            <div className="app-row" key={app.id}>
              <AppMark identity={app.identity} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>{app.name}</div>
                <div className="minor">{app.detail}</div>
              </div>
              <button
                type="button"
                className="btn danger small"
                onClick={() => void onRevoke(app.id)}
              >
                Revoke
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ApprovalsList({
  items,
  busy,
  onDecide,
}: {
  items: ApprovalView[];
  busy: string | null;
  onDecide: (id: string, approve: boolean) => Promise<void>;
}) {
  const pending = items.filter((item) => item.status === "pending");
  const decided = items.filter((item) => item.status !== "pending");
  return (
    <section>
      <div className="section-head">
        <h2>Approvals</h2>
        {pending.length > 0 ? <span className="hint">{pending.length} waiting</span> : null}
      </div>
      {items.length === 0 ? (
        <div className="list edge">
          <Empty
            title="No approvals"
            body="An app asks here before it writes a file or runs a command. Nothing is waiting right now."
          />
        </div>
      ) : null}
      {pending.map((item) => (
        <ApprovalCard key={item.id} item={item} busy={busy} onDecide={onDecide} />
      ))}
      {decided.length > 0 ? (
        <div className="list edge decided-list">
          {decided.map((item) => (
            <div className="app-row" key={item.id}>
              <AppMark identity={item.client} small />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>
                  {approvalTitle(item)}
                  {item.path ? <span className="path"> {item.path}</span> : null}
                </div>
                <div className="minor">
                  {item.folderLabel} · {item.status}
                  {item.decidedAt ? ` · ${when(item.decidedAt)}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function approvalTitle(item: ApprovalView): string {
  if (item.tool === "run_command") {
    return `Run ${item.argv.join(" ")}`;
  }
  if (item.tool === "delete_file") {
    return "Delete file";
  }
  return "Write file";
}

// parseDiff turns a unified diff into hunks of numbered rows. The file
// headers (--- / +++) are dropped: GitHub shows the file name above the
// diff, not inside it. A hunk header (@@) becomes a plain separator row
// carrying only its trailing section text.
export type DiffLine = {
  kind: "add" | "del" | "ctx" | "note";
  oldNo: number | null;
  newNo: number | null;
  text: string;
};

export type DiffHunk = {
  head: string;
  lines: DiffLine[];
};

export function parseDiff(text: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let oldNo = 0;
  let newNo = 0;
  let current: DiffHunk | null = null;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("--- ") || raw.startsWith("+++ ")) continue;
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (hunk) {
      const [, oldStart = "0", newStart = "0", head = ""] = hunk;
      oldNo = Number.parseInt(oldStart, 10);
      newNo = Number.parseInt(newStart, 10);
      current = { head: head.trim(), lines: [] };
      hunks.push(current);
      continue;
    }
    if (raw === "") continue;
    if (!current) {
      current = { head: "", lines: [] };
      hunks.push(current);
    }
    if (raw.startsWith("+")) {
      current.lines.push({ kind: "add", oldNo: null, newNo: newNo++, text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      current.lines.push({ kind: "del", oldNo: oldNo++, newNo: null, text: raw.slice(1) });
    } else if (raw.startsWith("\\")) {
      current.lines.push({ kind: "note", oldNo: null, newNo: null, text: raw });
    } else if (raw.startsWith(" ")) {
      current.lines.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: raw.slice(1) });
    } else {
      current.lines.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: raw });
    }
  }
  return hunks;
}

// DiffView renders a unified diff the way GitHub does: old and new line
// numbers, green added rows, red removed rows, and no raw --- / +++ / @@
// markers. Long lines scroll sideways instead of wrapping.
export function DiffView({ diff }: { diff: string }) {
  const hunks = parseDiff(diff);
  return (
    <div className="diff-table">
      {hunks.map((hunk, hi) => (
        <div key={hi}>
          <div className="diff-hunk">{hunk.head || "···"}</div>
          {hunk.lines.map((line, li) => (
            <div key={li} className={`diff-row diff-${line.kind}`}>
              <span className="diff-no">{line.oldNo ?? ""}</span>
              <span className="diff-no">{line.newNo ?? ""}</span>
              <span className="diff-sign">
                {line.kind === "add" ? "+" : line.kind === "del" ? "-" : ""}
              </span>
              <span className="diff-text">{line.text || " "}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ApprovalCard({
  item,
  busy,
  onDecide,
}: {
  item: ApprovalView;
  busy: string | null;
  onDecide: (id: string, approve: boolean) => Promise<void>;
}) {
  const deciding = busy === item.id;
  return (
    <div className="approval edge">
      <div className="approval-tag-row">
        <span className="approval-tag">Approval requested</span>
        <span className="badge waiting">waiting</span>
      </div>
      <div className="approval-head">
        <AppMark identity={item.client} small />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div>{approvalTitle(item)}</div>
          <div className="minor">
            {item.folderLabel}
            {item.path ? ` · ${item.path}` : ""}
            {` · expires ${when(item.expiresAt)}`}
          </div>
        </div>
      </div>
      {item.tool === "run_command" ? (
        <div className="minor">Command: {item.argv.join(" ")}</div>
      ) : null}
      {item.diff ? <DiffView diff={item.diff} /> : null}
      {item.preview ? <pre className="diff">{item.preview}</pre> : null}
      <div className="cta" style={{ justifyContent: "flex-start" }}>
        <button
          type="button"
          className="btn small"
          disabled={deciding}
          onClick={() => void onDecide(item.id, true)}
        >
          Approve
        </button>
        <button
          type="button"
          className="btn quiet small"
          disabled={deciding}
          onClick={() => void onDecide(item.id, false)}
        >
          Deny
        </button>
      </div>
      <p className="minor">
        Approved once, for these exact bytes. The request expires after 24 hours, and the approval
        cannot be reused.
      </p>
    </div>
  );
}

export function ActivityList({
  items,
  limit,
  onShowAll,
}: {
  items: ActivityView[];
  limit?: number;
  onShowAll?: () => void;
}) {
  const shown = limit === undefined ? items : items.slice(0, limit);
  return (
    <section>
      <div className="section-head">
        <h2>Activity</h2>
      </div>
      <div className="list edge">
        {items.length === 0 ? (
          <Empty
            title="No read log"
            body="FolderLink does not store what an app reads. A refusal happens on your computer, and the file stays there."
          />
        ) : (
          <>
            {shown.map((item) => (
              <div className="app-row" key={item.id}>
                <AppMark identity={item.client} small />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row-line">
                    {item.action}
                    {item.target ? <span className="path"> {item.target}</span> : null}
                  </div>
                  <div className="minor">
                    {when(item.time)} · {item.detail}
                  </div>
                </div>
                {item.denied ? (
                  <span className="badge refused">refused</span>
                ) : (
                  <span className="tag act">{item.action.split("_")[0]}</span>
                )}
              </div>
            ))}
            {onShowAll && items.length > shown.length ? (
              <button type="button" className="btn quiet small more-btn" onClick={onShowAll}>
                More
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="state">
      <strong>{title}</strong>
      {body}
    </div>
  );
}

function toDevice(device: Device): DashboardData["devices"][number] {
  return {
    id: device.id,
    name: device.name || "laptop",
    status: device.status,
    online: device.online,
    os: device.os,
    arch: device.arch,
    fingerprint: device.fingerprint,
    network: device.network,
    version: device.version,
    lastSeenAt: device.lastSeenAt,
    pairedAt: device.pairedAt,
  };
}

function toFolder(folder: Folder): FolderView {
  const approval =
    folder.approval === "approved" || folder.approval === "revoked" ? folder.approval : "pending";
  return {
    id: folder.id,
    label: folder.label,
    approval,
    deviceName: folder.deviceName,
    detail: approval === "approved" ? "read-only" : "paused · hidden from AI",
    apps: folder.apps ?? null,
  };
}

function toApproval(item: {
  id: string;
  tool: string;
  op: string;
  folderId: string;
  folderLabel: string;
  path: string;
  client: string;
  contentHash: string;
  preHash: string;
  diff: string;
  preview: string;
  argv: string[];
  size: number;
  status: string;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  executedAt: string | null;
}): ApprovalView {
  const status =
    item.status === "pending" ||
    item.status === "approved" ||
    item.status === "denied" ||
    item.status === "expired" ||
    item.status === "executed" ||
    item.status === "failed"
      ? item.status
      : "pending";
  return { ...item, client: identityFromServer(item.client), status };
}
