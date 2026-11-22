import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api, ApiError, type User } from "../api.ts";

export function Shell() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let gone = false;
    api
      .me()
      .then((result) => {
        if (!gone) {
          setUser(result.user);
        }
      })
      .catch(() => {
        if (!gone) {
          setUser(null);
        }
      });
    return () => {
      gone = true;
    };
  }, []);

  async function logout() {
    try {
      await api.logout();
    } catch (err) {
      if (!(err instanceof ApiError)) {
        return;
      }
    }
    setUser(null);
    navigate("/");
  }

  return (
    <>
      <a className="skip" href="#content">
        Skip to content
      </a>
      <header className="top">
        <NavLink className="mark" to="/">
          <span>mcp</span> bridge
        </NavLink>
        <nav>
          <NavLink to="/connect">Pair</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <a href="https://github.com/mmuizahmed/mcp-bridge">Source</a>
          {user ? (
            <button type="button" className="text-button" onClick={() => void logout()}>
              Sign out
            </button>
          ) : null}
        </nav>
      </header>
      <main id="content">
        <Outlet context={{ user, setUser }} />
      </main>
    </>
  );
}

export interface ShellContext {
  user: User | null;
  setUser: (user: User | null) => void;
}
