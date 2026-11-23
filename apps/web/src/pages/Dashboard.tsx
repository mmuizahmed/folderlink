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
  Mark,
} from "../components/Icons.tsx";
import { initials, screenMode } from "../data/mode.ts";
import type { ActivityView, AppView, DashboardData, FolderView, ViewState } from "../data/types.ts";

type Section = "overview" | "devices" | "folders" | "apps" | "activity" | "settings";

const NAV: Array<{
  id: Section;
  label: string;
  icon: ReactNode;
  count?: "devices" | "folders" | "apps";
}> = [
  { id: "overview", label: "Overview", icon: <IconGrid /> },
  {
    id: "devices",
    label: "Devices",
    icon: <IconLaptop width="15" height="15" />,
    count: "devices",
  },
  { id: "folders", label: "Folders", icon: <IconFolder />, count: "folders" },
  { id: "apps", label: "AI apps", icon: <IconApps />, count: "apps" },
  { id: "activity", label: "Activity", icon: <IconActivity /> },
  { id: "settings", label: "Settings", icon: <IconSettings /> },
];

export function Dashboard() {
  const navigate = useNavigate();
  const mode = screenMode();
  const [section, setSection] = useState<Section>("overview");
  const [menu, setMenu] = useState(false);
  const [state, setState] = useState<ViewState<DashboardData>>({ status: "loading" });
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  usePageTitle("Dashboard · FolderLink");

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
        const [devices, folders, apps, activity] = await Promise.all([
          api.devices(),
          api.folders(),
          api.apps().catch(() => ({ apps: [] as Array<{ id: string; name: string }> })),
          api.activity().catch(() => ({ activity: [] as DashboardData["activity"] })),
        ]);
        if (gone) return;
        const data: DashboardData = {
          user: me.user,
          devices: devices.devices.map(toDevice),
          folders: folders.folders.map(toFolder),
          apps: apps.apps.map((app) => ({
            id: app.id,
            name: app.name,
            mark: app.name.slice(0, 1).toUpperCase() || "A",
            tone: "gpt" as const,
            detail: "Read-only",
          })),
          activity: activity.activity,
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

  const ready = state.status === "ready" ? state.data : null;

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
                setMenu(false);
              }}
            >
              {item.icon}
              {item.label}
              {item.count && ready ? (
                <span className="count">{ready[item.count].length}</span>
              ) : null}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          {ready ? (
            <div className="account">
              <span className="avatar lg">{initials(ready.user.name, ready.user.email)}</span>
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
          <NavLink className="btn small" to={mode === "live" ? "/pair" : "/pair?fixture=1"}>
            + Pair device
          </NavLink>
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
              notice={notice}
              onToggle={toggleFolder}
              onRemove={removeDevice}
              onRename={renameDevice}
              onAdd={addFolder}
              adding={adding}
              onRenameFolder={renameFolder}
              onRemoveFolder={removeFolder}
              onRevoke={revokeApp}
            />
          ) : null}
          {ready && section === "devices" ? (
            <DeviceList data={ready} onRemove={removeDevice} onRename={renameDevice} />
          ) : null}
          {ready && section === "folders" ? (
            <FolderList
              data={ready}
              onToggle={toggleFolder}
              onAdd={addFolder}
              adding={adding}
              onRename={renameFolder}
              onRemove={removeFolder}
              notice={notice}
            />
          ) : null}
          {ready && section === "apps" ? <AppList apps={ready.apps} onRevoke={revokeApp} /> : null}
          {ready && section === "activity" ? <ActivityList items={ready.activity} /> : null}
          {ready && section === "settings" ? (
            <section>
              <h2>Settings</h2>
              <p className="minor">Signed in as {ready.user.email}</p>
              <div className="cta" style={{ justifyContent: "flex-start" }}>
                <button type="button" className="btn quiet small" onClick={() => void logout()}>
                  Sign out
                </button>
              </div>
              <p className="minor">
                ChatGPT and Claude connect from their own apps. You do not create a token here.
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Overview({
  data,
  notice,
  onToggle,
  onRemove,
  onRename,
  onAdd,
  adding,
  onRenameFolder,
  onRemoveFolder,
  onRevoke,
}: {
  data: DashboardData;
  notice: string;
  onToggle: (folder: FolderView) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onAdd: () => Promise<void>;
  adding: boolean;
  onRenameFolder: (id: string, label: string) => Promise<void>;
  onRemoveFolder: (id: string) => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
}) {
  const device = data.devices[0];
  return (
    <>
      <Checklist data={data} onAdd={onAdd} adding={adding} />
      {device ? (
        <DeviceCard device={device} onRemove={onRemove} onRename={onRename} />
      ) : (
        <div className="state">
          <strong>No device yet</strong>
          Open FolderLink. It connects automatically.
        </div>
      )}
      <div className="split">
        <div>
          <FolderList
            data={data}
            onToggle={onToggle}
            onAdd={onAdd}
            adding={adding}
            onRename={onRenameFolder}
            onRemove={onRemoveFolder}
            notice={notice}
          />
          <AppList apps={data.apps} onRevoke={onRevoke} />
        </div>
        <ActivityList items={data.activity} />
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
      body: "Leave the FolderLink window open.",
    },
    { done: hasFolder, title: "Add a folder", body: "The path stays on this computer." },
    {
      done: hasApp,
      title: "Connect ChatGPT or Claude",
      body: "Add this address as a custom connector.",
    },
  ];
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

function when(value: string | null): string {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not yet";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function DeviceList({
  data,
  onRemove,
  onRename,
}: {
  data: DashboardData;
  onRemove: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
}) {
  if (data.devices.length === 0)
    return (
      <Empty
        title="No devices"
        body="Download FolderLink and open it. It connects automatically."
      />
    );
  return (
    <div>
      {data.devices.map((device) => (
        <div key={device.id} style={{ marginBottom: 16 }}>
          <DeviceCard device={device} onRemove={onRemove} onRename={onRename} />
        </div>
      ))}
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
  notice,
}: {
  data: DashboardData;
  onToggle: (folder: FolderView) => Promise<void>;
  onAdd: () => Promise<void>;
  adding: boolean;
  onRename: (id: string, label: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
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
            <div className="folder-row" key={folder.id}>
              <button
                type="button"
                className={on ? "toggle on" : "toggle"}
                aria-pressed={on}
                aria-label={`${on ? "Pause" : "Allow"} ${folder.label}`}
                onClick={() => void onToggle(folder)}
              />
              <div className="folder-main">
                <div className={on ? "path" : "path paused"} title={folder.label}>
                  {folder.label}
                </div>
                <div className="minor">{folder.detail}</div>
              </div>
              <span className={on ? "tag" : "tag dim"}>read-only</span>
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

function AppList({ apps, onRevoke }: { apps: AppView[]; onRevoke: (id: string) => Promise<void> }) {
  return (
    <section>
      <div className="section-head">
        <h2>AI apps</h2>
      </div>
      <div className="list edge">
        {apps.length === 0 ? (
          <Empty
            title="No connected apps"
            body="Connect ChatGPT or Claude to https://folderlink.muiz.pk/mcp. An app shows up here after you allow it."
          />
        ) : (
          apps.map((app) => (
            <div className="app-row" key={app.id}>
              <span className={`app-mark ${app.tone}`}>{app.mark}</span>
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

function ActivityList({ items }: { items: ActivityView[] }) {
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
          items.map((item) => (
            <div className="app-row" key={item.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>
                  {item.action}
                  {item.target ? <span className="path"> {item.target}</span> : null}
                </div>
                <div className="minor">
                  {when(item.time)} · {item.detail}
                </div>
              </div>
              {item.denied ? <span className="badge">refused</span> : null}
            </div>
          ))
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
  };
}
