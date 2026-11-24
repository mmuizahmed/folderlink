import { useState } from "react";
import { Link } from "react-router-dom";
import { AccountMenu } from "../components/AccountMenu.tsx";
import { SiteFooter } from "../components/SiteFooter.tsx";
import { Mark } from "../components/Icons.tsx";
import { installCommandForThisComputer } from "../downloads.ts";
import { usePageTitle, useSession } from "../session.ts";

const RELEASES = "https://github.com/mmuizahmed/mcp-bridge/releases";
const SOURCE = "https://github.com/mmuizahmed/mcp-bridge";
const LATEST = "https://github.com/mmuizahmed/mcp-bridge/releases/latest/download";

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
          Open source
        </a>
        <h1 className="display">
          Your folders.
          <br />
          <span>Your AI.</span>
        </h1>
        <p className="lede">
          Let ChatGPT, Claude and other AI apps read the project folders you choose. No uploads, no
          copy-paste. Writes need approval, and every change is logged.
        </p>
        <div className="cta">
          <InstallCommand command={installCommand} />
          <Link className="chip" to="/docs/getting-started">
            Getting started
          </Link>
        </div>
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
            <span className="go">✓</span> Paired to muiz@example.com
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
          <div className="kicker">01 run</div>
          <h3>Install FolderLink</h3>
          <p>One command installs it. It runs in the background, with no terminal window.</p>
        </article>
        <article>
          <div className="kicker">02 pair</div>
          <h3>Approve and add a folder</h3>
          <p>Sign in with Google, allow this computer, then pick a project from the dashboard.</p>
        </article>
        <article>
          <div className="kicker">03 connect</div>
          <h3>Add to ChatGPT or Claude</h3>
          <p>
            Point the connector at <span className="fg mono">folderlink.muiz.pk/mcp</span>. Done.
          </p>
        </article>
      </div>
      <div className="audit" id="security">
        <div>
          <h3>Built to be audited</h3>
          <p>Every line is public. Self-host the whole stack if you would rather not trust ours.</p>
        </div>
        <div>
          <div className="kicker">approval-gated</div>
          <p>Writes and commands need your approval.</p>
        </div>
        <div>
          <div className="kicker">local allowlist</div>
          <p>Folders are enforced on your laptop, not our server.</p>
        </div>
        <div>
          <div className="kicker">secrets blocked</div>
          <p>
            <span className="fg mono">.env</span>, keys and certs are never sent.
          </p>
        </div>
      </div>
      <section className="band" id="apps">
        <h2>Works with the apps you already use</h2>
        <div className="steps">
          <article>
            <div className="kicker">ChatGPT</div>
            <h3>Custom connector</h3>
            <p>Add https://folderlink.muiz.pk/mcp and allow read-only access.</p>
          </article>
          <article>
            <div className="kicker">Claude</div>
            <h3>Custom connector</h3>
            <p>The same address. Claude asks you before the first read.</p>
          </article>
          <article>
            <div className="kicker">Others</div>
            <h3>Any MCP client</h3>
            <p>Clients that speak MCP OAuth can connect. The scope is read-only.</p>
          </article>
        </div>
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
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
