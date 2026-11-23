import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { normalizePairingCode } from "@mcp-bridge/shared";
import { IconLaptop, Mark } from "../components/Icons.tsx";
import { api, ApiError } from "../api.ts";
import { fixturePreview, fixtureUser } from "../data/fixture.ts";
import { initials, screenMode } from "../data/mode.ts";
import type { PairPreview, SessionUser } from "../data/types.ts";

const EMPTY = ["", "", "", "", "", "", "", ""];

export function Pair() {
  const navigate = useNavigate();
  const mode = screenMode();
  const [user, setUser] = useState<SessionUser | null>(mode === "live" ? null : fixtureUser);
  const [google, setGoogle] = useState(false);
  const [dev, setDev] = useState(false);
  const [chars, setChars] = useState<string[]>(
    mode === "live" ? EMPTY : ["K", "7", "Q", "M", "2", "X", "P", "A"],
  );
  const [preview, setPreview] = useState<PairPreview | null>(
    mode === "live" ? null : fixturePreview,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (mode !== "live") {
      return;
    }
    api
      .config()
      .then((config) => {
        setGoogle(config.google);
        setDev(config.dev);
      })
      .catch(() => setError("The control service is not reachable."));
    api
      .me()
      .then((result) => setUser(result.user))
      .catch(() => setUser(null));
  }, [mode]);

  useEffect(() => {
    if (!preview) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [preview]);

  const code = chars.join("");
  const normalized = normalizePairingCode(`${code.slice(0, 4)}-${code.slice(4)}`);

  useEffect(() => {
    if (mode !== "live" || !user || !normalized) {
      return;
    }
    let gone = false;
    api
      .preview(normalized)
      .then((next) => {
        if (!gone) {
          setPreview(next);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (!gone) {
          setPreview(null);
          setError(err instanceof ApiError ? err.message : "That code could not be checked.");
        }
      });
    return () => {
      gone = true;
    };
  }, [mode, user, normalized]);

  const expiry = useMemo(() => {
    if (!preview) {
      return "";
    }
    if (mode !== "live") {
      return "08:41";
    }
    const left = Math.max(0, Math.floor((Date.parse(preview.expiresAt) - now) / 1000));
    const minutes = String(Math.floor(left / 60)).padStart(2, "0");
    const seconds = String(left % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [mode, preview, now]);

  function onPaste(text: string) {
    const next = normalizePairingCode(text);
    if (!next) {
      return;
    }
    setChars(next.split(""));
  }

  function onKey(index: number, key: string) {
    if (key === "Backspace") {
      const next = [...chars];
      next[index] = "";
      setChars(next);
      focusCell(Math.max(0, index - 1));
      return;
    }
    if (key === "Enter" && preview) {
      void approve();
      return;
    }
    if (!/^[a-z0-9]$/i.test(key)) {
      return;
    }
    const next = [...chars];
    next[index] = key.toUpperCase();
    setChars(next);
    focusCell(Math.min(7, index + 1));
  }

  async function devSignIn() {
    setBusy(true);
    setError("");
    try {
      const result = await api.devSession();
      setUser(result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!normalized) {
      return;
    }
    if (mode !== "live") {
      navigate("/dashboard?fixture=1");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.completePair(normalized);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
  }

  function deny() {
    setChars(EMPTY);
    setPreview(null);
    setError("");
    focusCell(0);
  }

  return (
    <div className="pair-page">
      <div className="glow" />
      <header className="pair-top">
        <div className="pair-top-inner">
          <Link to="/" aria-label="bridge home">
            <Mark />
          </Link>
          {user ? (
            <div className="who">
              <span className="avatar">{initials(user.name, user.email)}</span>
              {user.email}
            </div>
          ) : (
            <Link className="signin" to="/pair">
              Sign in
            </Link>
          )}
        </div>
      </header>
      <div className="pair-card">
        <div className="prompt-box" aria-hidden="true">
          &gt;_
        </div>
        <h1>Connect a device</h1>
        <p className="sub">Enter the code from your bridge terminal.</p>
        {!user ? (
          <div className="pair-actions" style={{ marginTop: 28 }}>
            {google ? (
              <a className="btn" href="/api/auth/google">
                Continue with Google
              </a>
            ) : (
              <p className="sub">Google sign-in is not configured on this server.</p>
            )}
            {dev ? (
              <button
                type="button"
                className="btn quiet"
                disabled={busy}
                onClick={() => void devSignIn()}
              >
                Local session
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="cells" role="group" aria-label="Pairing code">
          {chars.flatMap((char, index) => {
            const nodes: ReactNode[] = [
              <input
                key={index}
                id={`code-${index}`}
                className={activeCell(chars, index) ? "cell-input active" : "cell-input"}
                aria-label={`Character ${index + 1}`}
                inputMode="text"
                autoComplete="off"
                maxLength={index === 0 ? 9 : 1}
                value={char}
                disabled={!user || busy}
                onPaste={(event) => {
                  event.preventDefault();
                  onPaste(event.clipboardData.getData("text"));
                }}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value.length > 1) {
                    onPaste(value);
                    return;
                  }
                  if (value) {
                    onKey(index, value);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" || event.key === "Enter") {
                    event.preventDefault();
                    onKey(index, event.key);
                  }
                }}
              />,
            ];
            if (index === 3) {
              nodes.push(
                <span className="hyphen" key="hyphen">
                  -
                </span>,
              );
            }
            return nodes;
          })}
        </div>
        <div className="match" role="status">
          {preview ? `✓ match · expires in ${expiry}` : ""}
        </div>
        {error ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        {preview ? (
          <section className="device edge" aria-label="Device asking to pair">
            <div className="device-head">
              <IconLaptop />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="name path">{preview.name}</div>
                <div className="ask">is requesting access to your account</div>
              </div>
              <span className="badge">pending</span>
            </div>
            <dl className="meta">
              <dt>os</dt>
              <dd>
                {preview.os} · {preview.arch}
              </dd>
              <dt>ip</dt>
              <dd className="path">{preview.network}</dd>
              <dt>key</dt>
              <dd className="path">{preview.fingerprint}</dd>
              <dt>folders</dt>
              <dd className="faint">{preview.folders}</dd>
            </dl>
            <div className="warn-row">
              <span className="warn">!</span>
              <span>
                Didn’t start this yourself? Deny it. Someone may be trying to link their laptop to
                you.
              </span>
            </div>
          </section>
        ) : null}
        <div className="pair-actions">
          <button type="button" className="btn quiet" onClick={deny} disabled={!user}>
            Deny
          </button>
          <button
            type="button"
            className="btn"
            disabled={!user || !preview || busy}
            onClick={() => void approve()}
          >
            Approve <span className="kbd">↵</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function focusCell(index: number) {
  document.getElementById(`code-${index}`)?.focus();
}

function activeCell(chars: string[], index: number): boolean {
  const empty = chars.findIndex((item) => item === "");
  if (empty === -1) {
    return index === chars.length - 1;
  }
  return index === empty;
}
