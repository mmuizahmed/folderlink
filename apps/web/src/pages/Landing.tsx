import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AccountMenu } from "../components/AccountMenu.tsx";
import { SiteFooter } from "../components/SiteFooter.tsx";
import { LogoMark, Mark } from "../components/Icons.tsx";
import { installCommandForThisComputer } from "../downloads.ts";
import { usePageTitle, useSession } from "../session.ts";
import { logoForIdentity, markForIdentity, toneForIdentity } from "../data/apps.ts";
import type { AppIdentity } from "../data/types.ts";

const RELEASES = "https://github.com/mmuizahmed/folderlink/releases";
const SOURCE = "https://github.com/mmuizahmed/folderlink";
const LATEST = "https://github.com/mmuizahmed/folderlink/releases/latest/download";
const MCP = "https://folderlink.muiz.pk/mcp";
const PS_COMMAND = "irm https://folderlink.muiz.pk/install.ps1 | iex";
const SH_COMMAND = "curl -fsSL https://folderlink.muiz.pk/install.sh | sh";

// Hero headline typewriter, Antigravity-style: the H1 types itself
// character by character (~18 chars/sec) with a coral caret following the
// last typed character. The pill and CTAs stay hidden until typing finishes
// (gated on `done` via the .fl-typed class on the hero). Under
// prefers-reduced-motion the full headline renders immediately and `done`
// starts true, so tests and snapshots see the final page.
const HERO_LINES = ["Your folders.", "Your AI."] as const;
const HERO_LINE1_LEN = HERO_LINES[0].length;
const HERO_TOTAL = HERO_LINES[0].length + HERO_LINES[1].length;
const TYPE_MS = 55;

function useHeroTypewriter() {
  const [count, setCount] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? HERO_TOTAL
      : 0,
  );
  const done = count >= HERO_TOTAL;
  useEffect(() => {
    if (done) return;
    const id = window.setTimeout(() => setCount((c) => Math.min(c + 1, HERO_TOTAL)), TYPE_MS);
    return () => window.clearTimeout(id);
  }, [count, done]);
  return {
    line1: HERO_LINES[0].slice(0, Math.min(count, HERO_LINE1_LEN)),
    line2: count > HERO_LINE1_LEN ? HERO_LINES[1].slice(0, count - HERO_LINE1_LEN) : "",
    done,
    caretOnLine2: count > HERO_LINE1_LEN,
  };
}

// HeroParticles: Antigravity's ambient particle layer — a quiet field of
// tiny dots drifting very slowly across the hero. Pure DOM spans,
// transform-only drift, denser near the edges and sparse in the centre so
// the headline stays legible. Fixed positions/durations so every load looks
// the same; under prefers-reduced-motion the global rule stops the drift
// and the dots sit static.
type Particle = {
  left: number;
  top: number;
  size: number;
  tone: "coral" | "white" | "soft";
  dur: number;
  delay: number;
  dx: number;
  dy: number;
};
const PARTICLES: Particle[] = [
  { left: 3, top: 8, size: 3, tone: "coral", dur: 42, delay: -10, dx: 12, dy: -8 },
  { left: 8, top: 22, size: 2, tone: "white", dur: 55, delay: -30, dx: -10, dy: 12 },
  { left: 5, top: 38, size: 4, tone: "soft", dur: 36, delay: -18, dx: 8, dy: 10 },
  { left: 11, top: 52, size: 2, tone: "coral", dur: 48, delay: -24, dx: -12, dy: -6 },
  { left: 2, top: 64, size: 3, tone: "white", dur: 60, delay: -40, dx: 10, dy: -12 },
  { left: 15, top: 12, size: 2, tone: "soft", dur: 44, delay: -8, dx: -8, dy: 8 },
  { left: 20, top: 30, size: 3, tone: "coral", dur: 38, delay: -26, dx: 12, dy: 6 },
  { left: 24, top: 48, size: 2, tone: "white", dur: 52, delay: -14, dx: -10, dy: -10 },
  { left: 18, top: 68, size: 2, tone: "soft", dur: 40, delay: -32, dx: 8, dy: -8 },
  { left: 30, top: 58, size: 2, tone: "coral", dur: 58, delay: -20, dx: -6, dy: 10 },
  { left: 96, top: 10, size: 3, tone: "coral", dur: 46, delay: -16, dx: -12, dy: 8 },
  { left: 91, top: 26, size: 2, tone: "white", dur: 40, delay: -28, dx: 10, dy: -10 },
  { left: 95, top: 44, size: 4, tone: "soft", dur: 54, delay: -6, dx: -8, dy: -12 },
  { left: 88, top: 60, size: 2, tone: "coral", dur: 36, delay: -22, dx: 12, dy: 10 },
  { left: 97, top: 72, size: 3, tone: "white", dur: 50, delay: -36, dx: -10, dy: 6 },
  { left: 84, top: 16, size: 2, tone: "soft", dur: 44, delay: -12, dx: 8, dy: -8 },
  { left: 79, top: 34, size: 3, tone: "coral", dur: 58, delay: -34, dx: -12, dy: -6 },
  { left: 74, top: 52, size: 2, tone: "white", dur: 42, delay: -18, dx: 10, dy: 12 },
  { left: 82, top: 70, size: 2, tone: "soft", dur: 48, delay: -26, dx: -8, dy: -10 },
  { left: 68, top: 64, size: 2, tone: "coral", dur: 56, delay: -10, dx: 6, dy: 8 },
  { left: 6, top: 82, size: 2, tone: "coral", dur: 52, delay: -44, dx: 10, dy: -8 },
  { left: 94, top: 84, size: 2, tone: "soft", dur: 46, delay: -38, dx: -8, dy: 10 },
];

function HeroParticles() {
  return (
    <>
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className={`fl-dot ${p.tone}`}
          aria-hidden="true"
          style={
            {
              left: `${p.left}%`,
              top: `${p.top}%`,
              width: p.size,
              height: p.size,
              animationDuration: `${p.dur}s`,
              animationDelay: `${p.delay}s`,
              "--dx": `${p.dx}px`,
              "--dy": `${p.dy}px`,
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}

// InstallCommand is the primary install path: the one-line installer for
// this computer, as a copyable mono line. The Copy button flips to "Copied"
// and back after 2s.
function InstallCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fl-install-line">
      <code>
        <span className="fl-prompt">{command.startsWith("irm") ? "PS> " : "$ "}</span>
        {command}
      </code>
      <button
        type="button"
        className={copied ? "fl-copy copied" : "fl-copy"}
        onClick={() => {
          void navigator.clipboard.writeText(command).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

// AppLogo shows an AI app's real brand logo in the same chip the dashboard
// uses (see AppMark in Dashboard.tsx). The logo fills the chip; the Claude
// mark is inverted to white on the coral chip (see logoForIdentity).
// `xl` is the landing Apps section size (56px) — the dashboard's 40px
// `.app-mark.lg` is untouched.
function AppLogo({ identity, xl }: { identity: AppIdentity; xl?: boolean }) {
  const logo = logoForIdentity(identity);
  return (
    <span className={`app-mark ${xl ? "xl" : "lg"} ${toneForIdentity(identity)}`} title={identity}>
      {logo ? (
        <img src={logo.src} alt={identity} className={logo.invert ? "invert" : undefined} />
      ) : (
        markForIdentity(identity)
      )}
    </span>
  );
}

// Reveal fades a section in once it scrolls into view (IntersectionObserver,
// transform + opacity only). Under prefers-reduced-motion the global rule
// disables the transition, and the observer still adds the class, so the
// content renders in its final state immediately.
function Reveal({ id, children, delay }: { id?: string; children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-visible");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      id={id}
      ref={ref}
      className="fl-reveal"
      style={delay === undefined ? undefined : { transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

// DashboardMock is the hero product visual: the real FolderLink dashboard,
// built in CSS so it can animate on load and its approval card works. All
// data is generic — no real names, emails, devices, or folder paths.
// Layout is the Overview dashboard: sidebar + Overview heading, the
// approval card on top, then shared folders beside the activity log.
function DashboardMock() {
  const [decision, setDecision] = useState<"approved" | "denied" | null>(null);
  return (
    <div
      className="fl-mock"
      aria-label="Preview of the FolderLink dashboard: overview, shared folders, activity log, and a write-approval request awaiting a decision."
    >
      <div className="fl-mock-bar">
        <span className="fl-t-dot" />
        <span className="fl-t-dot" />
        <span className="fl-t-dot" />
        <span className="fl-mock-title">FolderLink — Dashboard</span>
        <span className="fl-mock-status">
          <i />
          Connected
        </span>
      </div>
      <div className="fl-mock-body">
        <div className="fl-mock-side">
          <span className="fl-side-brand">
            <LogoMark width={16} height={16} />
            FolderLink
          </span>
          <span className="fl-side-link active">Overview</span>
          <span className="fl-side-link">Folders</span>
          <span className="fl-side-link">
            Approvals <b className="fl-side-badge">1</b>
          </span>
          <span className="fl-side-link">Activity</span>
          <span className="fl-side-link">Devices</span>
          <span className="fl-side-link">Settings</span>
          <span className="fl-side-foot">
            <i />
            Bridge connected
          </span>
        </div>
        <div className="fl-mock-main">
          <div className="fl-overview-head">
            <h3>Overview</h3>
            <span>3 folders shared · 3 apps connected</span>
          </div>
          <div
            className={
              decision === "approved"
                ? "fl-approval resolved-approve"
                : decision === "denied"
                  ? "fl-approval resolved-deny"
                  : "fl-approval"
            }
          >
            <div className="fl-a-head">
              <span className="fl-a-tag">Approval requested</span>
              <span className="fl-a-badge">Pending</span>
            </div>
            <p>
              <strong>Muse</strong> wants to write to <code>notes.md</code> in the folder{" "}
              <strong>notes</strong>.
            </p>
            <p className="fl-a-diff">
              <code>notes.md</code> <span className="fl-add">+42 lines</span>{" "}
              <span className="fl-del">−0 lines</span> · write_file
            </p>
            <div className="fl-a-actions">
              <button type="button" className="fl-approve" onClick={() => setDecision("approved")}>
                Approve
              </button>
              <button type="button" className="fl-deny" onClick={() => setDecision("denied")}>
                Deny
              </button>
            </div>
            <p className="fl-a-result" role="status">
              {decision === "approved"
                ? "✓ APPROVED — write applied and logged."
                : decision === "denied"
                  ? "✕ DENIED — nothing was written."
                  : ""}
            </p>
          </div>
          <div className="fl-overview-cols">
            <div>
              <p className="fl-col-h">
                Shared folders <span>3</span>
              </p>
              <div className="fl-ov-folder">
                <span className="fl-ov-dot" />
                <div className="fl-ov-info">
                  <span className="fl-ov-name">website</span>
                  <span className="fl-ov-path">C:\Users\you\projects\website</span>
                </div>
                <span className="fl-f-apps">
                  <AppLogo identity="chatgpt" />
                  <AppLogo identity="claude" />
                  <AppLogo identity="muse" />
                </span>
              </div>
              <div className="fl-ov-folder">
                <span className="fl-ov-dot" />
                <div className="fl-ov-info">
                  <span className="fl-ov-name">notes</span>
                  <span className="fl-ov-path">C:\Users\you\documents\notes</span>
                </div>
                <span className="fl-f-apps">
                  <AppLogo identity="muse" />
                </span>
              </div>
              <div className="fl-ov-folder">
                <span className="fl-ov-dot" />
                <div className="fl-ov-info">
                  <span className="fl-ov-name">photos</span>
                  <span className="fl-ov-path">C:\Users\you\pictures\photos</span>
                </div>
                <span className="fl-f-apps">
                  <AppLogo identity="chatgpt" />
                  <AppLogo identity="muse" />
                </span>
              </div>
            </div>
            <div>
              <p className="fl-col-h">
                Activity <span>Today</span>
              </p>
              <ul className="fl-ov-log">
                <li>
                  <time>14:02</time>
                  <span>
                    <b>Muse</b> read <b>README.md</b>
                  </span>
                  <span className="fl-ov-tag">read</span>
                </li>
                <li>
                  <time>13:47</time>
                  <span>
                    <b>Claude</b> searched “approval”
                  </span>
                  <span className="fl-ov-tag">search</span>
                </li>
                <li>
                  <time>13:31</time>
                  <span>
                    <b>ChatGPT</b> read <b>package.json</b>
                  </span>
                  <span className="fl-ov-tag">read</span>
                </li>
                <li>
                  <time>12:58</time>
                  <span>
                    Write to <b>notes.md</b> approved
                  </span>
                  <span className="fl-ov-tag ok">approved</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// InstallBand is the install section: OS tabs switch the one-line command,
// the Copy button flips to "Copied", and the manual downloads sit below.
function InstallBand() {
  const [os, setOs] = useState<"windows" | "mac">("windows");
  const shown = os === "windows" ? PS_COMMAND : SH_COMMAND;
  return (
    <div className="fl-install-band">
      <div className="fl-tabs" role="tablist" aria-label="Install commands">
        <button
          type="button"
          role="tab"
          aria-selected={os === "windows"}
          className={os === "windows" ? "fl-tab selected" : "fl-tab"}
          onClick={() => setOs("windows")}
        >
          Windows · PowerShell
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={os === "mac"}
          className={os === "mac" ? "fl-tab selected" : "fl-tab"}
          onClick={() => setOs("mac")}
        >
          macOS · Linux
        </button>
      </div>
      <InstallCommand command={shown} />
      <p className="fl-cmd-note">
        {os === "windows"
          ? "Windows: paste into PowerShell and press Enter. macOS and Linux use a curl one-liner instead — switch tabs above."
          : "macOS and Linux: paste into a terminal and press Enter. Windows uses the PowerShell one-liner instead — switch tabs above."}
      </p>
      <p className="fl-manual">
        <span>Manual download:</span>
        <a href={`${LATEST}/folderlink_windows_amd64.zip`}>Windows</a>
        <a href={`${LATEST}/folderlink_darwin_arm64.tar.gz`}>Mac</a>
        <a href={`${LATEST}/folderlink_linux_amd64.tar.gz`}>Linux</a>
        <a href={RELEASES}>Other platforms</a>
      </p>
      <p className="fl-cmd-note">
        The installer checks checksums.txt first, so a bad download fails instead of installing.
      </p>
      <p>
        <Link className="fl-btn fl-btn-ghost" to="/docs/getting-started">
          Getting started
        </Link>
      </p>
    </div>
  );
}

export function Landing() {
  const session = useSession();
  const installCommand = installCommandForThisComputer();
  const { line1, line2, done, caretOnLine2 } = useHeroTypewriter();
  usePageTitle("FolderLink");
  return (
    <div className="fl">
      <header className="top">
        <div className="top-inner">
          <Link to="/" aria-label="FolderLink home">
            <Mark />
          </Link>
          <nav className="nav" aria-label="Primary">
            <a href="#how">How it works</a>
            <a href="#security">Security</a>
            <Link to="/docs/getting-started">Docs</Link>
            <a href={RELEASES}>Changelog</a>
          </nav>
          <div className="top-actions">
            {session.status === "in" ? (
              <AccountMenu user={session.user} />
            ) : (
              <Link className="signin" to="/pair">
                Sign in
              </Link>
            )}
            <a className="btn small" href="#install">
              Install
            </a>
          </div>
        </div>
      </header>

      <section className={done ? "fl-hero fl-typed" : "fl-hero"} aria-label="Introduction">
        <div className="fl-aurora" aria-hidden="true">
          <div className="fl-aurora-field" />
          <div className="fl-streak" />
          <div className="fl-streak s2" />
          <div className="fl-streak s3" />
          <HeroParticles />
        </div>
        <div className="fl-hero-inner">
          <a className="fl-pill" href={SOURCE}>
            <span className="fl-pill-dot" />
            Free &amp; open source · Windows · macOS · Linux
          </a>
          <h1 className="fl-h1">
            <span className="fl-type-line">
              {line1}
              {!done && !caretOnLine2 && <span className="fl-caret" aria-hidden="true" />}
            </span>
            <br />
            <span className="fl-type-line">
              {line2}
              {!done && caretOnLine2 && <span className="fl-caret" aria-hidden="true" />}
            </span>
          </h1>
          <p className="fl-lede">
            Let <strong>ChatGPT, Claude, and Muse</strong> read the project folders you choose. No
            uploads, no copy-paste. Writes need approval, and every change is logged.
          </p>
          <div className="fl-hero-actions">
            <a className="fl-btn fl-btn-white" href="#install">
              Install FolderLink
            </a>
            <a className="fl-btn fl-btn-ghost" href="#how">
              See how it works
            </a>
          </div>
          <p className="fl-hero-meta">
            <span>Free &amp; open source</span>
            <span>Windows · macOS · Linux</span>
            <span>MIT licensed</span>
          </p>
          <InstallCommand command={installCommand} />
          <div className="fl-mock-stage">
            <div className="fl-mock-glow" aria-hidden="true" />
            <DashboardMock />
          </div>
          <p className="fl-proof">
            <span>
              MIT licensed · <a href={SOURCE}>Source on GitHub</a> · No extra subscription
            </span>
          </p>
        </div>
      </section>

      <Reveal id="install">
        <section className="fl-block">
          <div className="fl-section-head left">
            <span className="fl-num">01 — Install</span>
            <h2>One command. Thirty seconds.</h2>
            <p>Pick your system. The bridge installs, sits in the tray, and starts at login.</p>
          </div>
          <InstallBand />
        </section>
      </Reveal>

      <Reveal id="how">
        <section className="fl-block">
          <div className="fl-section-head left">
            <span className="fl-num">02 — How it works</span>
            <h2>Three steps, then ask away.</h2>
            <p>
              Your files never leave the laptop ahead of time. An app only ever sees the file it
              asks for.
            </p>
          </div>
          <ol className="fl-steps">
            <li>
              <span className="fl-step-no">/ 01</span>
              <div>
                <h3>Run the installer</h3>
                <p>
                  One command installs the bridge. It runs in the system tray and starts
                  automatically at login.
                </p>
              </div>
            </li>
            <li>
              <span className="fl-step-no">/ 02</span>
              <div>
                <h3>Pair the laptop</h3>
                <p>
                  Pair once from the dashboard. Then right-click any folder in Explorer and choose
                  “Share with FolderLink”.
                </p>
              </div>
            </li>
            <li>
              <span className="fl-step-no">/ 03</span>
              <div>
                <h3>Connect the AI app</h3>
                <p>
                  Point ChatGPT, Claude, or Muse at <a href={MCP}>https://folderlink.muiz.pk/mcp</a>
                  . Ask it about your code — it reads the folder, live.
                </p>
              </div>
            </li>
          </ol>
        </section>
      </Reveal>

      <Reveal id="features">
        <section className="fl-block">
          <div className="fl-section-head left">
            <span className="fl-num">03 — Features</span>
            <h2>Everything it does. Nothing it doesn’t.</h2>
            <p>Nine things, each doing one job. No bloat, no dashboard you have to babysit.</p>
          </div>
          <ul className="fl-features">
            <li>
              <span className="fl-f-label">read + search</span>
              <div>
                <h3>Read and search files</h3>
                <p>
                  Your AI reads files and searches across the folders you share — live, from your
                  laptop.
                </p>
              </div>
            </li>
            <li>
              <span className="fl-f-label">approval-gated writes</span>
              <div>
                <h3>Writes behind dashboard approval</h3>
                <p>
                  Nothing is written without your approval in the dashboard. Every write is logged.
                </p>
              </div>
            </li>
            <li>
              <span className="fl-f-label">allowlisted commands</span>
              <div>
                <h3>Run commands from an allowlist</h3>
                <p>
                  Commands run only if they are on your local allowlist. Anything else is refused.
                </p>
              </div>
            </li>
            <li>
              <span className="fl-f-label">per-app scoping</span>
              <div>
                <h3>Per-app folder scoping</h3>
                <p>
                  Each app sees only the folders you gave it. ChatGPT never sees Muse’s folders
                  unless you say so.
                </p>
              </div>
            </li>
            <li>
              <span className="fl-f-label">activity log</span>
              <div>
                <h3>Full activity log</h3>
                <p>
                  Every read, write, and command is recorded with the app, the file, and the time.
                </p>
              </div>
            </li>
            <li>
              <span className="fl-f-label">auto-update</span>
              <div>
                <h3>Auto-update</h3>
                <p>
                  The bridge updates itself, so you always run the latest version without thinking
                  about it.
                </p>
              </div>
            </li>
            <li>
              <span className="fl-f-label">system tray</span>
              <div>
                <h3>System tray</h3>
                <p>Status, dashboard, restart, and quit — one click from the tray icon.</p>
              </div>
            </li>
            <li>
              <span className="fl-f-label">one-line install</span>
              <div>
                <h3>One-line install</h3>
                <p>A single command on Windows, macOS, and Linux. No accounts, no setup wizard.</p>
              </div>
            </li>
            <li>
              <span className="fl-f-label">right-click share</span>
              <div>
                <h3>Explorer right-click “Share with FolderLink”</h3>
                <p>
                  Share a folder straight from Windows Explorer — no need to open the dashboard
                  first.
                </p>
              </div>
            </li>
          </ul>
        </section>
      </Reveal>

      <Reveal id="apps">
        <section className="fl-block">
          <div className="fl-section-head left">
            <span className="fl-num">04 — Apps</span>
            <h2>Works with the AI you already use.</h2>
            <p>One address connects them all. No extra subscription, no new account.</p>
          </div>
          <ul className="fl-apps">
            <li>
              <AppLogo identity="chatgpt" xl />
              <div>
                <h3>ChatGPT</h3>
                <p>Connect as an MCP server.</p>
              </div>
              <span className="fl-app-mcp">
                <b>MCP</b> · https://folderlink.muiz.pk/mcp
              </span>
            </li>
            <li>
              <AppLogo identity="claude" xl />
              <div>
                <h3>Claude</h3>
                <p>Connect as an MCP server.</p>
              </div>
              <span className="fl-app-mcp">
                <b>MCP</b> · https://folderlink.muiz.pk/mcp
              </span>
            </li>
            <li>
              <AppLogo identity="muse" xl />
              <div>
                <h3>Muse</h3>
                <p>Connect as an MCP server.</p>
              </div>
              <span className="fl-app-mcp">
                <b>MCP</b> · https://folderlink.muiz.pk/mcp
              </span>
            </li>
          </ul>
          <p className="fl-apps-note">Any MCP client can connect — the address is the same.</p>
        </section>
      </Reveal>

      <Reveal id="security">
        <section className="fl-block">
          <div className="fl-section-head">
            <span className="fl-num">05 — Security</span>
            <h2>Your laptop stays in charge.</h2>
            <p>Three guardrails, always on. There is no way around them from the AI side.</p>
          </div>
          <div className="fl-security-grid">
            <div>
              <span className="fl-s-mark">Guardrail 01</span>
              <h3>Approval-gated writes</h3>
              <p>
                Every write waits for your approval in the dashboard. Unapproved writes never
                happen.
              </p>
            </div>
            <div>
              <span className="fl-s-mark">Guardrail 02</span>
              <h3>Local allowlist</h3>
              <p>
                Commands run only from a local allowlist you control. Everything else is refused
                outright.
              </p>
            </div>
            <div>
              <span className="fl-s-mark">Guardrail 03</span>
              <h3>Secrets blocked</h3>
              <p>
                Sensitive files such as .env and keys are blocked from being read — they never leave
                the laptop.
              </p>
            </div>
          </div>
        </section>
      </Reveal>

      <Reveal id="faq">
        <section className="fl-block">
          <div className="fl-section-head">
            <span className="fl-num">06 — FAQ</span>
            <h2>Asked, answered.</h2>
          </div>
          <div className="fl-faq">
            <details>
              <summary>Does a file get uploaded ahead of time?</summary>
              <p>
                No. Only the file an app asks for leaves the laptop, and nothing is stored ahead of
                time.
              </p>
            </details>
            <details>
              <summary>Can it change my files?</summary>
              <p>
                Only with your dashboard approval. Every write is logged, so you can always see what
                changed and when.
              </p>
            </details>
            <details>
              <summary>What do I install?</summary>
              <p>
                One command. The bridge runs in the tray and starts at login — there is nothing else
                to set up.
              </p>
            </details>
            <details>
              <summary>Does it work when my laptop is off?</summary>
              <p>
                No. Your laptop must be on and connected — the files live there, not in a cloud.
              </p>
            </details>
            <details>
              <summary>Is my data private?</summary>
              <p>
                Files stay on the laptop. Only the requested file leaves, and nothing is stored.
              </p>
            </details>
            <details>
              <summary>Do I need a paid ChatGPT, Claude, or Muse plan?</summary>
              <p>No extra subscription. It works with the apps you already use.</p>
            </details>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="fl-final">
          <h2>Stop copy-pasting. Start asking.</h2>
          <p>Your folders, your AI — connected in one command.</p>
          <a className="fl-btn fl-btn-white" href="#install">
            Install FolderLink
          </a>
        </section>
      </Reveal>

      <SiteFooter />
    </div>
  );
}
