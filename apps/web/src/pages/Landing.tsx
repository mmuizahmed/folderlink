import { useState } from "react";
import { Link } from "react-router-dom";
import { AccountMenu } from "../components/AccountMenu.tsx";
import { SiteFooter } from "../components/SiteFooter.tsx";
import {
  IconActivity,
  IconApps,
  IconDownload,
  IconFolder,
  IconLaptop,
  IconRefresh,
  IconSearch,
  IconShield,
  IconTerminal,
  Mark,
} from "../components/Icons.tsx";
import { installCommandForThisComputer } from "../downloads.ts";
import { usePageTitle, useSession } from "../session.ts";
import { logoForIdentity, markForIdentity, toneForIdentity } from "../data/apps.ts";
import type { AppIdentity } from "../data/types.ts";

const RELEASES = "https://github.com/mmuizahmed/folderlink/releases";
const SOURCE = "https://github.com/mmuizahmed/folderlink";
const LATEST = "https://github.com/mmuizahmed/folderlink/releases/latest/download";
const MCP = "https://folderlink.muiz.pk/mcp";

// InstallCommand is the primary install path: the one-line installer for
// this computer, as a copyable code block. The ZIP download is only a
// manual fallback further down the page.
function InstallCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="install-command">
      <pre>{command}</pre>
      <button
        type="button"
        className="btn quiet small"
        onClick={() => {
          void navigator.clipboard.writeText(command).then(() => {
            setCopied(true);
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
function AppLogo({ identity }: { identity: AppIdentity }) {
  const logo = logoForIdentity(identity);
  return (
    <span className={`app-mark lg ${toneForIdentity(identity)}`} title={identity}>
      {logo ? (
        <img src={logo.src} alt={identity} className={logo.invert ? "invert" : undefined} />
      ) : (
        markForIdentity(identity)
      )}
    </span>
  );
}

export function Landing() {
  const session = useSession();
  const installCommand = installCommandForThisComputer();
  usePageTitle("FolderLink");
  return (
    <div className="hero">
      <div className="glow" />
      <div className="dots" />
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
            <a className="btn small" href="#download">
              Install
            </a>
          </div>
        </div>
      </header>
      <div className="hero-inner">
        <a className="pill" href={SOURCE}>
          Free &amp; open source
        </a>
        <h1 className="display">
          Your folders.
          <br />
          <span>Your AI.</span>
        </h1>
        <p className="lede">
          Let ChatGPT, Claude, and Muse read the project folders you choose. No uploads, no
          copy-paste. Writes need approval, and every change is logged.
        </p>
        <div className="cta">
          <InstallCommand command={installCommand} />
          <Link className="chip" to="/docs/getting-started">
            Getting started
          </Link>
        </div>
        <p className="hero-note">Windows · macOS · Linux — free, no extra subscription.</p>
        <div className="terminal edge" aria-label="Sample bridge output">
          <div className="terminal-bar">
            <div className="lights" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <span className="terminal-title">FolderLink</span>
          </div>
          <pre>
            <span className="go">✓</span> Opening the browser to connect
            {"\n"}
            <span className="go">✓</span> Connected to folderlink.muiz.pk
            {"\n"}
            <span className="go">✓</span> Paired to you@example.com
            {"\n"}
            <span className="go">✓</span> Ready — 3 folders shared
          </pre>
        </div>
        <figure className="product-frame">
          <img
            className="product-shot"
            src="/product.png"
            alt="FolderLink dashboard showing a connected computer and the folders it may read"
          />
        </figure>
      </div>
      <div className="steps" id="how">
        <article>
          <div className="step-icon" aria-hidden="true">
            <IconLaptop />
          </div>
          <div className="kicker">01 run</div>
          <h3>Install FolderLink</h3>
          <p>One command installs it. It runs in the background, with no terminal window.</p>
        </article>
        <article>
          <div className="step-icon" aria-hidden="true">
            <IconFolder />
          </div>
          <div className="kicker">02 pair</div>
          <h3>Approve and add a folder</h3>
          <p>Sign in with Google, allow this computer, then pick a project from the dashboard.</p>
        </article>
        <article>
          <div className="step-icon" aria-hidden="true">
            <IconApps />
          </div>
          <div className="kicker">03 connect</div>
          <h3>Add to ChatGPT, Claude, or Muse</h3>
          <p>
            Point the connector at <span className="fg mono">folderlink.muiz.pk/mcp</span>. Done.
          </p>
        </article>
      </div>
      <section className="band" id="features">
        <h2>Everything you need to work with your files</h2>
        <div className="features">
          <article>
            <div className="feature-icon" aria-hidden="true">
              <IconSearch />
            </div>
            <h3>Read &amp; search files</h3>
            <p>Read any file in an allowed folder, and search across it with line numbers.</p>
          </article>
          <article>
            <div className="feature-icon" aria-hidden="true">
              <IconShield />
            </div>
            <h3>Write with approval</h3>
            <p>
              Every write needs your approval in the dashboard first. Nothing changes behind your
              back.
            </p>
          </article>
          <article>
            <div className="feature-icon" aria-hidden="true">
              <IconTerminal />
            </div>
            <h3>Run commands</h3>
            <p>Commands run only from a safe allowlist, with a time limit and a capped output.</p>
          </article>
          <article>
            <div className="feature-icon" aria-hidden="true">
              <IconApps />
            </div>
            <h3>Per-app folder access</h3>
            <p>Choose which AI app sees which folder — or keep a folder to yourself.</p>
          </article>
          <article>
            <div className="feature-icon" aria-hidden="true">
              <IconActivity />
            </div>
            <h3>Activity log</h3>
            <p>Every read, write, and refusal is logged, so you can see exactly what happened.</p>
          </article>
          <article>
            <div className="feature-icon" aria-hidden="true">
              <IconRefresh />
            </div>
            <h3>Auto-update</h3>
            <p>New versions install themselves from the tray. You stay on the latest build.</p>
          </article>
          <article>
            <div className="feature-icon" aria-hidden="true">
              <IconLaptop />
            </div>
            <h3>System tray</h3>
            <p>Status, dashboard, restart, and quit — right from the tray icon.</p>
          </article>
          <article>
            <div className="feature-icon" aria-hidden="true">
              <IconDownload />
            </div>
            <h3>One-line install</h3>
            <p>A single command installs it in the background.</p>
          </article>
          <article>
            <div className="feature-icon" aria-hidden="true">
              <IconFolder />
            </div>
            <h3>Explorer right-click</h3>
            <p>Share any folder from Windows Explorer with one right-click.</p>
          </article>
        </div>
      </section>
      <section className="band" id="security">
        <h2>Built to be audited</h2>
        <p className="sub">
          Every line is public. Self-host the whole stack if you would rather not trust ours.
        </p>
        <div className="steps">
          <article>
            <div className="kicker">approval-gated</div>
            <h3>Writes need your approval</h3>
            <p>Every write needs your approval in the dashboard first.</p>
          </article>
          <article>
            <div className="kicker">local allowlist</div>
            <h3>Enforced on your laptop</h3>
            <p>Folders are enforced on your laptop, not our server.</p>
          </article>
          <article>
            <div className="kicker">secrets blocked</div>
            <h3>Secrets never leave</h3>
            <p>
              <span className="fg mono">.env</span>, keys and certs are never sent.
            </p>
          </article>
        </div>
      </section>
      <section className="band" id="apps">
        <h2>Works with the apps you already use</h2>
        <div className="steps">
          <article>
            <AppLogo identity="chatgpt" />
            <h3>ChatGPT</h3>
            <p>
              Add <span className="fg mono">{MCP}</span> as a custom connector.
            </p>
          </article>
          <article>
            <AppLogo identity="claude" />
            <h3>Claude</h3>
            <p>The same address. Claude asks you before the first read.</p>
          </article>
          <article>
            <AppLogo identity="muse" />
            <h3>Muse</h3>
            <p>The same address. Add it as a custom connector in Muse.</p>
          </article>
        </div>
        <p className="apps-note">Any MCP client can connect — the address is the same.</p>
      </section>
      <section className="band" id="download">
        <h2>Install</h2>
        <p className="sub">
          One command installs it in the background. The installer checks checksums.txt first, so a
          bad download fails instead of installing.
        </p>
        <InstallCommand command={installCommand} />
        <p className="platforms">
          <span>Manual download:</span>
          <a href={`${LATEST}/folderlink_windows_amd64.zip`}>Windows</a>
          <a href={`${LATEST}/folderlink_darwin_arm64.tar.gz`}>Mac</a>
          <a href={`${LATEST}/folderlink_linux_amd64.tar.gz`}>Linux</a>
          <a href={RELEASES}>Other platforms</a>
        </p>
        <p>
          <Link className="btn small" to="/docs/getting-started">
            Getting started
          </Link>
        </p>
      </section>
      <section className="band" id="faq">
        <h2>Questions</h2>
        <div className="faq">
          <article>
            <h3>Does a file get uploaded ahead of time?</h3>
            <p>No. A file leaves the laptop only when an app asks for it, and it is not stored.</p>
          </article>
          <article>
            <h3>Can it change my files?</h3>
            <p>Yes, once you approve it. Writes, deletes, and commands need dashboard approval.</p>
          </article>
          <article>
            <h3>What do I install?</h3>
            <p>One program for Windows, macOS, or Linux. It does not need administrator rights.</p>
          </article>
          <article>
            <h3>Does it work when my laptop is off?</h3>
            <p>
              No. Your laptop has to be on and connected — the files live on it, and nothing is
              stored in the cloud.
            </p>
          </article>
          <article>
            <h3>Is my data private?</h3>
            <p>
              Yes. Files stay on your laptop; only the file an app asks for leaves it, and it is not
              stored.
            </p>
          </article>
          <article>
            <h3>Do I need a paid ChatGPT, Claude, or Muse plan?</h3>
            <p>No extra subscription. It works with the AI apps you already use.</p>
          </article>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
