import { useEffect, useState } from "react";
import { api, ApiError, type AuthConfig } from "./api.ts";
import { fixtureUser } from "./data/fixture.ts";
import { screenMode, type ScreenMode } from "./data/mode.ts";
import type { SessionUser } from "./data/types.ts";

export type SessionState =
  | { status: "loading"; google: boolean; dev: boolean; user: null }
  | { status: "out"; google: boolean; dev: boolean; user: null }
  | { status: "in"; google: boolean; dev: boolean; user: SessionUser }
  | { status: "error"; google: boolean; dev: boolean; user: null; message: string };

const signedInModes = new Set<ScreenMode>([
  "fixture",
  "empty",
  "error",
  "offline",
  "long",
  "code",
  "signed-in",
]);

export function useSession(): SessionState {
  const mode = screenMode();
  const [state, setState] = useState<SessionState>(() => previewState(mode));

  useEffect(() => {
    if (mode !== "live") {
      setState(previewState(mode));
      return;
    }
    let gone = false;
    setState({ status: "loading", google: false, dev: false, user: null });
    void (async () => {
      let config: AuthConfig = { google: false, dev: false };
      try {
        config = await api.config();
      } catch {
        config = { google: false, dev: false };
      }
      try {
        const me = await api.me();
        if (!gone) {
          setState({ status: "in", ...config, user: me.user });
        }
      } catch (err) {
        if (gone) return;
        if (err instanceof ApiError && err.status !== 401) {
          setState({
            status: "error",
            ...config,
            user: null,
            message: err.message,
          });
          return;
        }
        setState({ status: "out", ...config, user: null });
      }
    })();
    return () => {
      gone = true;
    };
  }, [mode]);

  return state;
}

function previewState(mode: ScreenMode): SessionState {
  if (mode === "loading") {
    return { status: "loading", google: true, dev: false, user: null };
  }
  if (mode === "signed-out") {
    return { status: "out", google: true, dev: false, user: null };
  }
  if (signedInModes.has(mode)) {
    return { status: "in", google: true, dev: false, user: fixtureUser };
  }
  return { status: "loading", google: false, dev: false, user: null };
}

export function googleSignInHref(next: string): string {
  return `/api/auth/google?next=${encodeURIComponent(next)}`;
}

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
