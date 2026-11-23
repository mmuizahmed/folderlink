import { Link } from "react-router-dom";
import { AccountMenu } from "../components/AccountMenu.tsx";
import { SiteFooter } from "../components/SiteFooter.tsx";
import { Mark } from "../components/Icons.tsx";
import { usePageTitle, useSession } from "../session.ts";

const RELEASES = "https://github.com/mmuizahmed/mcp-bridge/releases";
const SOURCE = "https://github.com/mmuizahmed/mcp-bridge";

export function Landing() {
  const session = useSession();
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
            <a href={`${SOURCE}/blob/main/docs/ARCHITECTURE.md`}>Docs</a>
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
            <a className="btn small" href={RELEASES}>
              Download
            </a>
          </div>
        </div>
      </header>
      <div className="hero-inner">
        <div className="pill">
          <span className="dot" />
          v0.1.0 · open source · MIT
        </div>
        <h1 className="display">
          Your folders.
          <br />
          <span>Your AI.</span>
        </h1>
        <p className="lede">
          A 5 MB FolderLink bridge that lets ChatGPT and Claude read the project folders you choose
          — read-only, logged, revocable in one click.
        </p>
        <div className="cta">
          <a className="btn" href={RELEASES}>
            Download
          </a>
          <a className="chip" href={SOURCE}>
            <span className="dollar">$</span> folderlink
          </a>
        </div>
        <div className="terminal edge" aria-label="Sample bridge output">
          <div className="terminal-bar">
            <div className="lights" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <span className="terminal-title">~/projects/raffle — folderlink</span>
          </div>
          <pre>
            <span className="faint">$</span> <span className="fg">folderlink</span>
            {"\n"}
            <span className="go">✓</span> device key ready{"      "}
            <span className="faint">ed25519 · 9F3A…C21E</span>
            {"\n"}
            <span className="go">✓</span> connected{"             "}
            <span className="faint">folderlink.muiz.pk · 38 ms</span>
            {"\n\n"}
            {"  "}Pair this laptop at <span className="linkish">folderlink.muiz.pk/pair</span> with
            code
            {"  "}
            <span className="code-pill">K7QM-2XPA</span>
            {"\n\n"}
            <span className="go">✓</span> paired to muiz@example.com
            {"\n"}
            <span className="faint">14:32:07</span>
            {"  read   ~/projects/raffle/src/draw.ts      "}
            <span className="faint">4.1 KB chatgpt</span>
            {"\n"}
            <span className="faint">14:32:09</span>
            {"  "}
            <span className="bad">deny</span>
            {"   ~/projects/raffle/.env              "}
            <span className="faint">secret file</span>
          </pre>
        </div>
      </div>
      <div className="steps" id="how">
        <article>
          <div className="kicker">01 run</div>
          <h3>Open FolderLink</h3>
          <p>One command installs it. Opening it connects this computer in your browser.</p>
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
          <div className="kicker">read-only</div>
          <p>Writes and commands do not exist in v0.1.</p>
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
        <h2>Download</h2>
        <p className="sub">The installer checks checksums.txt, then opens FolderLink.</p>
        <div className="install-lines">
          <pre>irm https://folderlink.muiz.pk/install.ps1 | iex</pre>
          <pre>curl -fsSL https://folderlink.muiz.pk/install.sh | sh</pre>
        </div>
        <p>
          <Link to="/docs/getting-started">Getting started</Link>
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
            <p>
              No. This version only reads, and it refuses secrets such as .env and private keys.
            </p>
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
