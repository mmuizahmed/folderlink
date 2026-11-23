import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { api, ApiError, type Device, type Folder } from "../api.ts";
import {
  IconActivity,
  IconApps,
  IconFolder,
  IconGrid,
  IconLaptop,
  IconSettings,
  Mark,
} from "../components/Icons.tsx";
import {
  emptyDashboard,
  fixtureDashboard,
  fixtureUser,
  offlineDashboard,
} from "../data/fixture.ts";
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
  const [token, setToken] = useState("");

  useEffect(() => {
    if (mode === "loading") {
      setState({ status: "loading" });
      return;
    }
    if (mode === "error") {
      setState({ status: "error", message: "The control service is not reachable." });
      return;
    }
    if (mode === "fixture" || mode === "long") {
      setState({ status: "ready", data: fixtureDashboard(mode === "long") });
      return;
    }
    if (mode === "offline") {
      setState({ status: "ready", data: offlineDashboard() });
      return;
    }
    if (mode === "empty") {
      setState({ status: "ready", data: emptyDashboard(fixtureUser) });
      return;
    }
    let gone = false;
    async function load() {
      try {
        const me = await api.me();
        const [devices, folders] = await Promise.all([api.devices(), api.folders()]);
        if (gone) return;
        const data = emptyDashboard(me.user);
        data.devices = devices.devices.map(toDevice);
        data.folders = folders.folders.map(toFolder);
        data.relay = data.devices.some((device) => device.online) ? "relay ok" : "relay idle";
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

  async function mint() {
    if (mode !== "live") {
      setToken("mb_example_token");
      return;
    }
    const issued = await api.createToken();
    setToken(issued.token);
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
          <Mark suffix={<span className="kbd-dark">⌘K</span>} />
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
          <div className="relay edge">
            <div className="line">
              <span className="dot" />
              {ready?.relay ?? "relay …"}
            </div>
            <div className="ver">v0.1.0</div>
          </div>
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
            <Overview data={ready} onToggle={toggleFolder} onRemove={removeDevice} />
          ) : null}
          {ready && section === "devices" ? (
            <DeviceList data={ready} onRemove={removeDevice} />
          ) : null}
          {ready && section === "folders" ? (
            <FolderList data={ready} onToggle={toggleFolder} />
          ) : null}
          {ready && section === "apps" ? <AppList apps={ready.apps} /> : null}
          {ready && section === "activity" ? <ActivityList rows={ready.activity} /> : null}
          {ready && section === "settings" ? (
            <section>
              <h2>Settings</h2>
              <p className="minor">Signed in as {ready.user.email}</p>
              <div className="cta" style={{ justifyContent: "flex-start" }}>
                <button type="button" className="btn small" onClick={() => void mint()}>
                  Create token
                </button>
                <button type="button" className="btn quiet small" onClick={() => void logout()}>
                  Sign out
                </button>
              </div>
              {token ? (
                <pre className="terminal" style={{ marginTop: 16, padding: 16 }}>
                  {token}
                </pre>
              ) : (
                <p className="minor">Tokens are shown once and expire in 45 minutes.</p>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Overview({
  data,
  onToggle,
  onRemove,
}: {
  data: DashboardData;
  onToggle: (folder: FolderView) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const device = data.devices[0];
  return (
    <>
      {device ? (
        <DeviceCard device={device} onRemove={onRemove} />
      ) : (
        <Empty title="No device yet" body="Pair a laptop to see it here." />
      )}
      <div className="split">
        <div>
          <FolderList data={data} onToggle={onToggle} />
          <AppList apps={data.apps} />
        </div>
        <ActivityList rows={data.activity} live={Boolean(device?.online)} />
      </div>
    </>
  );
}

function DeviceCard({
  device,
  onRemove,
}: {
  device: DashboardData["devices"][number];
  onRemove: (id: string) => Promise<void>;
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
            {device.os || "unknown"} · {device.arch || "unknown"} · folderlink {device.version} ·{" "}
            {device.fingerprint}
          </div>
        </div>
        <div className="stat-actions">
          <button type="button" className="btn quiet small" disabled>
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
      <div className="stats">
        <Stat label="uptime" value={device.uptimeLabel} />
        <Stat label="latency" value={device.latencyLabel} />
        <Stat
          label="reads today"
          value={device.readsToday === null ? "—" : String(device.readsToday)}
        />
        <Stat
          label="blocked"
          value={device.blocked === null ? "—" : String(device.blocked)}
          bad={Boolean(device.blocked)}
        />
      </div>
    </section>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={bad ? "value bad" : "value"}>{value}</div>
    </div>
  );
}

function DeviceList({
  data,
  onRemove,
}: {
  data: DashboardData;
  onRemove: (id: string) => Promise<void>;
}) {
  if (data.devices.length === 0)
    return (
      <Empty title="No devices" body="Run folderlink on a laptop and enter the pairing code." />
    );
  return (
    <div>
      {data.devices.map((device) => (
        <div key={device.id} style={{ marginBottom: 16 }}>
          <DeviceCard device={device} onRemove={onRemove} />
        </div>
      ))}
    </div>
  );
}

function FolderList({
  data,
  onToggle,
}: {
  data: DashboardData;
  onToggle: (folder: FolderView) => Promise<void>;
}) {
  return (
    <section>
      <div className="section-head">
        <h2>Folders</h2>
        <span className="hint">
          add with <code>folderlink allow ./path --label name</code>
        </span>
      </div>
      <div className="list edge">
        {data.folders.length === 0 ? (
          <Empty title="No folders" body="Add one on the laptop, then approve it here." />
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
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className={on ? "path" : "path paused"} title={folder.label}>
                  {folder.label}
                </div>
                <div className="minor">{folder.detail}</div>
              </div>
              <span className={on ? "tag" : "tag dim"}>read-only</span>
            </div>
          );
        })}
        <div className="blocked-note">always blocked: .env *.pem id_* .git/ node_modules/</div>
      </div>
    </section>
  );
}

function AppList({ apps }: { apps: AppView[] }) {
  return (
    <section>
      <div className="section-head">
        <h2>AI apps</h2>
      </div>
      <div className="list edge">
        {apps.length === 0 ? (
          <Empty
            title="No connected apps"
            body="Agents use a bearer token from Settings until connector sign-in is available."
          />
        ) : (
          apps.map((app) => (
            <div className="app-row" key={app.id}>
              <span className={`app-mark ${app.tone}`}>{app.mark}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>{app.name}</div>
                <div className="minor">{app.detail}</div>
              </div>
              <button type="button" className="btn danger small">
                Revoke
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ActivityList({ rows, live = false }: { rows: ActivityView[]; live?: boolean }) {
  return (
    <section>
      <div className="section-head">
        <h2>Activity</h2>
        {live ? (
          <span className="live">
            <span className="dot" />
            live
          </span>
        ) : null}
      </div>
      <div className="list edge">
        {rows.length === 0 ? (
          <Empty title="No activity yet" body="Reads and refusals will show up here." />
        ) : null}
        {rows.map((row) => (
          <div className={row.denied ? "log-row deny" : "log-row"} key={row.id}>
            <span className="faint">{row.time}</span>
            <span className={row.denied ? "bad" : undefined}>{row.action}</span>
            <span title={row.target}>
              {row.target} {row.detail ? <span className="faint">{row.detail}</span> : null}
            </span>
          </div>
        ))}
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
    version: "v0.1.0",
    lastSeenAt: device.lastSeenAt,
    uptimeLabel: "—",
    latencyLabel: "—",
    readsToday: null,
    blocked: null,
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
