import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { SiteFooter } from "../components/SiteFooter.tsx";
import { Mark } from "../components/Icons.tsx";

const ISSUES = "https://github.com/mmuizahmed/mcp-bridge/issues";
const SOURCE = "https://github.com/mmuizahmed/mcp-bridge";
const SECURITY = "https://github.com/mmuizahmed/mcp-bridge/blob/main/SECURITY.md";
const SELF_HOST = "https://github.com/mmuizahmed/mcp-bridge/blob/main/docs/SELF-HOSTING.md";

export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="legal">
      <header className="top">
        <div className="top-inner">
          <Link to="/" aria-label="FolderLink home">
            <Mark />
          </Link>
        </div>
      </header>
      <main className="legal-main">
        <h1>{title}</h1>
        <p className="legal-date">Effective November 23, 2026</p>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

export function Privacy() {
  return (
    <LegalLayout title="Privacy">
      <p>
        FolderLink at folderlink.muiz.pk lets an AI app read folders you choose on your laptop. This
        page describes that hosted service. The program is open source. A copy you run yourself
        keeps its own database, and this page does not cover that copy.
      </p>

      <h2>Google sign-in</h2>
      <p>
        Sign-in uses Google, and only the openid, email, and profile scopes. From that response we
        keep your name, email address, Google account id, and the avatar URL Google sends. We do not
        receive your Google password, contacts, or Drive files.
      </p>

      <h2>Files</h2>
      <p>
        A file leaves your laptop only when an AI app asks for it. The server passes those bytes on
        to the app and does not write them into the database. A directory listing is handled the
        same way. The folder path stays on the laptop. The server stores the short label you choose,
        such as notes, and whether you approved that label.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>
          Your account: name, email, Google account id, avatar URL, whether the account is active or
          suspended, and when it was created and updated.
        </li>
        <li>
          Each device: its public key, the name it sends, operating system, architecture, the IP
          address it connected from, the country code Cloudflare attaches, when it was paired, and
          when it was last seen. The panel shows a shortened IP. The database keeps the address we
          received.
        </li>
        <li>Folder labels and their approval. Not the filesystem path.</li>
        <li>
          The panel session and access tokens as SHA-256 hashes, plus an expiry. The token string
          itself is not stored. A session cookie lasts 14 days. An access token lasts 45 minutes.
          Pairing codes are stored as hashes and expire after 10 minutes.
        </li>
        <li>
          A short-lived sign-in state, and nonces so a bridge message cannot be replayed. An MCP
          session id and protocol version are kept for up to 24 hours. Each failed pairing guess
          stores a timestamp so repeated guesses can be slowed down.
        </li>
      </ul>
      <p>
        We do not keep a log of each read. The server does not store the tool name, path, size, or
        file text from those calls. The activity list in the panel is empty in this version.
      </p>

      <h2>Who processes it</h2>
      <p>
        The hosted service runs on Cloudflare Workers. Account rows live in Cloudflare D1, and each
        device has a Durable Object for its live connection. Cloudflare processes the traffic and
        stores those records. The site has no ads. We do not sell data. The pages do not load an
        analytics or tracking script.
      </p>

      <h2>Delete your account</h2>
      <p>
        Open a <a href={ISSUES}>GitHub issue</a> and ask us to delete the account. If you would
        rather not post your email in public, write to the address in{" "}
        <a href={SECURITY}>SECURITY.md</a>, which is security@muiz.pk. We delete the account and the
        device, folder, session, and token rows tied to it. Files on your laptop were never copied
        into the database, so they stay on the laptop.
      </p>

      <h2>Self-hosting</h2>
      <p>
        The code is MIT licensed on <a href={SOURCE}>GitHub</a>. Setup for your own server is in the{" "}
        <a href={SELF_HOST}>self-hosting notes</a>. This policy describes folderlink.muiz.pk only.
      </p>
    </LegalLayout>
  );
}

export function Terms() {
  return (
    <LegalLayout title="Terms">
      <p>
        The FolderLink program is MIT licensed. The hosted service at folderlink.muiz.pk is offered
        as it is, with no warranty. You use it at your own risk. We may stop or change the service.
      </p>
      <p>
        Connect only folders you have the right to read. Do not use the service to reach someone
        else's files, to overload it, or to probe other people's accounts. We may suspend an account
        that does that.
      </p>
      <p>
        This version of the laptop bridge is read-only. You can revoke a device or a folder in the
        panel. Account deletion is described under <Link to="/privacy">Privacy</Link>.
      </p>
      <p>These terms cover the hosted service. The MIT license covers the code.</p>
    </LegalLayout>
  );
}
