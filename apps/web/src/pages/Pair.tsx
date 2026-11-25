import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { normalizePairingCode } from "@folderlink/shared";
import { AccountMenu, Avatar } from "../components/AccountMenu.tsx";
import { GoogleButton } from "../components/GoogleButton.tsx";
import { IconLaptop, Mark } from "../components/Icons.tsx";
import { api, ApiError } from "../api.ts";
import { screenMode } from "../data/mode.ts";
import { googleSignInHref, usePageTitle, useSession } from "../session.ts";
import type { PairPreview } from "../data/types.ts";

const EMPTY = ["", "", "", "", "", "", "", ""];

type Step = "code" | "confirm" | "done";

export function Pair() {
  const navigate = useNavigate();
  const mode = screenMode();
  const session = useSession();
  const user = session.user;
  usePageTitle("Connect a device · FolderLink");
  const [step, setStep] = useState<Step>("code");
  const [chars, setChars] = useState<string[]>(EMPTY);
  const [preview, setPreview] = useState<PairPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const code = chars.join("");
  const normalized = normalizePairingCode(code);
  const returnTo = `/pair${normalized ? `?code=${normalized}` : ""}`;

  useEffect(() => {
    if (!import.meta.env.DEV || mode !== "fixture") {
      return;
    }
    void import("../data/fixture.ts").then(({ fixturePreview }) => {
      setPreview(fixturePreview);
      setChars("K7QM2XPA".split(""));
      setStep("confirm");
    });
  }, [mode]);

  useEffect(() => {
    if (mode !== "live" || !user || step !== "code") {
      return;
    }
    const raw = new URLSearchParams(window.location.search).get("code");
    if (!raw) {
      focusCell(0);
      return;
    }
    const next = normalizePairingCode(raw);
    if (!next) {
      focusCell(0);
      return;
    }
    setChars(next.split(""));
    requestAnimationFrame(() => document.getElementById("pair-continue")?.focus());
  }, [mode, user, step]);

  useEffect(() => {
    if (!preview || step !== "confirm") {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [preview, step]);

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

  function fillCode(text: string) {
    const next = normalizePairingCode(text);
    if (!next) {
      return;
    }
    setChars(next.split(""));
    setError("");
    requestAnimationFrame(() => document.getElementById("pair-continue")?.focus());
  }

  function onKey(index: number, key: string) {
    if (key === "Backspace") {
      const next = [...chars];
      if (next[index]) {
        next[index] = "";
        setChars(next);
        return;
      }
      const previous = Math.max(0, index - 1);
      next[previous] = "";
      setChars(next);
      focusCell(previous);
      return;
    }
    if (key === "Enter" && normalized) {
      void lookup();
      return;
    }
    if (!/^[a-z0-9]$/i.test(key)) {
      return;
    }
    const next = [...chars];
    next[index] = key.toUpperCase();
    setChars(next);
    if (index < 7) {
      focusCell(index + 1);
    }
  }

  async function devSignIn() {
    setBusy(true);
    setError("");
    try {
      await api.devSession();
      window.location.assign(returnTo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed.");
      setBusy(false);
    }
  }

  async function lookup() {
    if (!normalized) {
      return;
    }
    if (import.meta.env.DEV && mode !== "live") {
      const { fixturePreview } = await import("../data/fixture.ts");
      setPreview(fixturePreview);
      setStep("confirm");
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await api.preview(normalized);
      setPreview(next);
      setStep("confirm");
    } catch (err) {
      setPreview(null);
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!normalized || !preview) {
      return;
    }
    if (mode !== "live") {
      navigate("/dashboard?fixture=empty");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.completePair(normalized);
      setStep("done");
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  function deny() {
    setPreview(null);
    setChars(EMPTY);
    setError("");
    setStep("code");
    requestAnimationFrame(() => focusCell(0));
  }

  return (
    <div className="pair-page">
      <div className="glow" />
      <header className="pair-top">
        <div className="pair-top-inner">
          <Link to="/" aria-label="FolderLink home">
            <Mark />
          </Link>
          {user ? (
            <AccountMenu user={user} />
          ) : (
            <Link className="signin" to="/pair">
              Sign in
            </Link>
          )}
        </div>
      </header>
      <div className="pair-card">
        {session.status === "loading" ? (
          <>
            <h1>Connect a device</h1>
            <p className="sub">Checking your session.</p>
          </>
        ) : null}
        {session.status === "error" ? (
          <>
            <h1>Connect a device</h1>
            <p className="alert" role="alert">
              {session.message}
            </p>
          </>
        ) : null}
        {session.status === "out" ? (
          <SignedOut
            google={session.google}
            dev={session.dev}
            busy={busy}
            next={returnTo}
            onDev={() => void devSignIn()}
          />
        ) : null}
        {user && step === "code" ? (
          <>
            <h1>Connect a device</h1>
            <p className="sub">Enter the code from the FolderLink bridge.</p>
            <SignedIn user={user} next={returnTo} />
            <CodeBoxes chars={chars} disabled={busy} onFill={fillCode} onKey={onKey} />
            {error ? (
              <p className="alert" role="alert">
                {error}
              </p>
            ) : null}
            <div className="pair-actions">
              <button
                id="pair-continue"
                type="button"
                className="btn"
                disabled={!normalized || busy}
                onClick={() => void lookup()}
              >
                {busy ? "Checking…" : "Continue"}
              </button>
            </div>
          </>
        ) : null}
        {user && step === "confirm" && preview ? (
          <>
            <h1>Allow this device</h1>
            <p className="sub">Check that this is the laptop you just started.</p>
            <SignedIn user={user} next={returnTo} />
            <DeviceCard preview={preview} expiry={expiry} />
            {error ? (
              <p className="alert" role="alert">
                {error}
              </p>
            ) : null}
            <div className="pair-actions">
              <button type="button" className="btn quiet" onClick={deny} disabled={busy}>
                Deny
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || code.length < 8}
                onClick={() => void approve()}
              >
                {busy ? "Connecting…" : "Approve"}
              </button>
            </div>
          </>
        ) : null}
        {user && step === "done" ? (
          <>
            <h1>Device connected</h1>
            <p className="sub">
              This laptop can now read the folders you approve. Create a token in the dashboard and
              add it in ChatGPT or Claude.
            </p>
            <div className="pair-actions">
              <Link className="btn" to="/dashboard">
                Open dashboard
              </Link>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SignedOut({
  google,
  dev,
  busy,
  next,
  onDev,
}: {
  google: boolean;
  dev: boolean;
  busy: boolean;
  next: string;
  onDev: () => void;
}) {
  return (
    <>
      <h1>Sign in to connect your device</h1>
      <p className="sub">The pairing code stays on the next screen, after your account is known.</p>
      <div className="pair-actions stack">
        {google ? (
          <GoogleButton href={googleSignInHref(next)} />
        ) : (
          <p className="sub">Google sign-in is not configured on this server.</p>
        )}
        {dev ? (
          <button type="button" className="btn quiet" disabled={busy} onClick={onDev}>
            Local session
          </button>
        ) : null}
      </div>
    </>
  );
}

function SignedIn({
  user,
  next,
}: {
  user: { id: string; name: string; email: string; avatarUrl?: string };
  next: string;
}) {
  return (
    <div className="signed-as">
      <Avatar user={user} />
      <div className="signed-copy">
        <div className="minor">Signed in as</div>
        <div className="path">{user.email}</div>
      </div>
      <a className="switch" href={googleSignInHref(next)}>
        Switch account
      </a>
    </div>
  );
}

function CodeBoxes({
  chars,
  disabled,
  onFill,
  onKey,
}: {
  chars: string[];
  disabled: boolean;
  onFill: (text: string) => void;
  onKey: (index: number, key: string) => void;
}) {
  return (
    <div
      className="cells"
      role="group"
      aria-label="Pairing code"
      onPaste={(event) => {
        event.preventDefault();
        onFill(event.clipboardData.getData("text"));
      }}
    >
      {chars.flatMap((char, index) => {
        const nodes: ReactNode[] = [
          <input
            key={index}
            id={`code-${index}`}
            className={activeCell(chars, index) ? "cell-input active" : "cell-input"}
            aria-label={`Character ${index + 1}`}
            inputMode="text"
            autoComplete="one-time-code"
            maxLength={index === 0 ? 9 : 1}
            value={char}
            disabled={disabled}
            onChange={(event) => {
              const value = event.target.value;
              if (value.length > 1) {
                onFill(value);
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
  );
}

function DeviceCard({ preview, expiry }: { preview: PairPreview; expiry: string }) {
  return (
    <section className="device edge" aria-label="Device asking to pair">
      <div className="device-head">
        <IconLaptop />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="name path">{preview.name}</div>
          <div className="ask">wants to join your account</div>
        </div>
        <span className="badge">pending</span>
      </div>
      <dl className="meta">
        <dt>os</dt>
        <dd>
          {preview.os} · {preview.arch}
        </dd>
        <dt>network</dt>
        <dd className="path">{preview.network}</dd>
        <dt>key</dt>
        <dd className="path">{preview.fingerprint}</dd>
        <dt>folders</dt>
        <dd className="faint">{preview.folders}</dd>
        <dt>expires</dt>
        <dd>{expiry}</dd>
      </dl>
      <div className="warn-row">
        <span className="warn">!</span>
        <span>Didn't start this yourself? Deny it. The code is not used until you approve.</span>
      </div>
    </section>
  );
}

function messageFor(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return "The control service is not reachable.";
  }
  if (err.code === "expired") {
    return "That code has expired. Run folderlink pair again for a new one.";
  }
  if (err.code === "rate_limited") {
    return "Too many attempts. Wait a few minutes, then try the code again.";
  }
  if (err.code === "conflict") {
    return "This device is already paired to an account.";
  }
  if (err.code === "invalid_code") {
    return "That code is not valid. It may be mistyped or already used.";
  }
  return err.message;
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
