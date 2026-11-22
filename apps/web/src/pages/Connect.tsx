import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { normalizePairingCode } from "@mcp-bridge/shared";
import { api, ApiError } from "../api.ts";
import type { ShellContext } from "../components/Shell.tsx";

export function Connect() {
  const navigate = useNavigate();
  const { user, setUser } = useOutletContext<ShellContext>();
  const [google, setGoogle] = useState(false);
  const [dev, setDev] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .config()
      .then((config) => {
        setGoogle(config.google);
        setDev(config.dev);
      })
      .catch(() => {
        setError("The control service is not reachable.");
      });
  }, []);

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

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizePairingCode(code);
    if (!normalized) {
      setError("Enter the 8-character code from the bridge.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.completePair(code);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="page narrow">
      <p className="eyebrow">Pair</p>
      <h1>Connect this computer.</h1>
      <p className="lede">
        Sign in, then enter the code printed by <code>mcp-bridge</code>. The code expires after ten
        minutes.
      </p>

      {user ? (
        <p className="signed-in">
          Signed in as <strong>{user.email}</strong>
        </p>
      ) : (
        <div className="signin">
          {google ? (
            <a className="button" href="/api/auth/google">
              Continue with Google
            </a>
          ) : (
            <p className="note">Google sign-in is not configured on this server.</p>
          )}
          {dev ? (
            <button
              type="button"
              className="button quiet"
              disabled={busy}
              onClick={() => void devSignIn()}
            >
              Use a local development session
            </button>
          ) : null}
        </div>
      )}

      <form className="pair-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="code">Pairing code</label>
        <input
          id="code"
          className="code-input"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          autoComplete="one-time-code"
          spellCheck={false}
          maxLength={9}
          placeholder="AB3D-EF2H"
          disabled={!user || busy}
        />
        <button className="button" type="submit" disabled={!user || busy}>
          Pair device
        </button>
      </form>
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
