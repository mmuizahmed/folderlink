import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, type Device, type Folder, type IssuedToken } from "../api.ts";
import { formatWhen } from "../format.ts";

export function Dashboard() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [error, setError] = useState("");
  const [token, setToken] = useState<IssuedToken | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [deviceResult, folderResult] = await Promise.all([api.devices(), api.folders()]);
      setDevices(deviceResult.devices);
      setFolders(folderResult.folders);
      setError("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        navigate("/connect");
        return;
      }
      setError(err instanceof ApiError ? err.message : "The control service is not reachable.");
    }
  }, [navigate]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function approval(id: string, next: "approved" | "revoked") {
    await api.setApproval(id, next);
    await load();
  }

  async function revoke(id: string) {
    await api.revokeDevice(id);
    await load();
  }

  async function createToken() {
    setError("");
    try {
      const issued = await api.createToken();
      setToken(issued);
      setCopied(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The token could not be created.");
    }
  }

  async function copyToken() {
    if (!token) {
      return;
    }
    await navigator.clipboard.writeText(token.token);
    setCopied(true);
  }

  return (
    <article className="page">
      <p className="eyebrow">Dashboard</p>
      <h1>Devices and folders</h1>
      <p className="lede">
        This is the control shell. Add folders on the laptop. Approve them here. Create a token when
        an agent needs to connect.
      </p>
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}

      <section className="panel">
        <header>
          <h2>Agent token</h2>
          <button type="button" className="button" onClick={() => void createToken()}>
            Create token
          </button>
        </header>
        {token ? (
          <div className="token">
            <p>Shown once. Valid until {new Date(token.expiresAt).toLocaleString()}.</p>
            <pre>{token.token}</pre>
            <button type="button" className="button quiet" onClick={() => void copyToken()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : (
          <p className="note">
            Use the token as a bearer credential on <code>/mcp</code>.
          </p>
        )}
      </section>

      <section className="panel">
        <header>
          <h2>Devices</h2>
        </header>
        {devices === null ? (
          <p className="note">Loading.</p>
        ) : devices.length === 0 ? (
          <p className="note">
            No device yet. <Link to="/connect">Pair one</Link>.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>State</th>
                <th>Last seen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id}>
                  <td>{device.name}</td>
                  <td>
                    <span
                      className={
                        device.online && device.status === "active" ? "status online" : "status"
                      }
                    >
                      <span className="dot" />
                      {device.status === "active"
                        ? device.online
                          ? "Connected"
                          : "Offline"
                        : device.status}
                    </span>
                  </td>
                  <td>{formatWhen(device.lastSeenAt)}</td>
                  <td className="end">
                    {device.status === "active" ? (
                      <button
                        type="button"
                        className="text-button danger"
                        onClick={() => void revoke(device.id)}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <header>
          <h2>Folders</h2>
        </header>
        {folders === null ? (
          <p className="note">Loading.</p>
        ) : folders.length === 0 ? (
          <p className="note">
            No folder yet. On the laptop, run{" "}
            <code>mcp-bridge allow &lt;directory&gt; --label notes</code>.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Device</th>
                <th>Approval</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {folders.map((folder) => (
                <tr key={folder.id}>
                  <td>{folder.label}</td>
                  <td>{folder.deviceName}</td>
                  <td className="cap">{folder.approval}</td>
                  <td className="end">
                    {folder.approval === "approved" ? (
                      <button
                        type="button"
                        className="text-button danger"
                        onClick={() => void approval(folder.id, "revoked")}
                      >
                        Revoke
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => void approval(folder.id, "approved")}
                      >
                        Approve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </article>
  );
}
