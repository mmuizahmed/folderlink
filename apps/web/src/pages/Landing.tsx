import { Link } from "react-router-dom";
import { Mark } from "../components/Icons.tsx";

const RELEASES = "https://github.com/mmuizahmed/mcp-bridge/releases";
const SOURCE = "https://github.com/mmuizahmed/mcp-bridge";

export function Landing() {
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
            <Link className="signin" to="/pair">
              Sign in
            </Link>
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
            <span className="faint">mcp.muiz.pk · 38 ms</span>
            {"\n\n"}
            {"  "}Pair this laptop at <span className="linkish">mcp.muiz.pk/pair</span> with code
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
          <h3>Run one file</h3>
          <p>No installer. It runs as your user and prints a pairing code.</p>
        </article>
        <article>
          <div className="kicker">02 pair</div>
          <h3>Pair and choose folders</h3>
          <p>Sign in with Google, enter the code, switch folders on or off.</p>
        </article>
        <article>
          <div className="kicker">03 connect</div>
          <h3>Add to ChatGPT or Claude</h3>
          <p>
            Point the connector at <span className="fg mono">mcp.muiz.pk/mcp</span>. Done.
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
    </div>
  );
}
