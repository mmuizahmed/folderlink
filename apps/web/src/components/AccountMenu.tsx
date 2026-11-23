import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.ts";
import { initials, screenMode } from "../data/mode.ts";
import type { SessionUser } from "../data/types.ts";

export function AccountMenu({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  const mode = screenMode();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  async function signOut() {
    setOpen(false);
    if (mode === "live") {
      try {
        await api.logout();
      } catch {
        // The cookie is cleared locally even if the request fails.
      }
    }
    navigate("/");
  }

  return (
    <div className="account-menu" ref={root}>
      <button
        type="button"
        className="avatar-btn"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu for ${user.email}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar user={user} />
        <span className="avatar-mail">{user.email}</span>
      </button>
      {open ? (
        <div className="menu-pop" role="menu">
          <Link role="menuitem" to="/dashboard" onClick={() => setOpen(false)}>
            Dashboard
          </Link>
          <button role="menuitem" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Avatar({ user }: { user: SessionUser }) {
  if (user.avatarUrl) {
    return <img className="avatar" src={user.avatarUrl} alt="" />;
  }
  return <span className="avatar">{initials(user.name, user.email)}</span>;
}
