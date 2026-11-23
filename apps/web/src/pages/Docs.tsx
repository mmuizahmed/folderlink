import { Link, Navigate, useParams } from "react-router-dom";
import { Mark } from "../components/Icons.tsx";
import { SiteFooter } from "../components/SiteFooter.tsx";
import { usePageTitle } from "../session.ts";

const PAGES = [
  {
    slug: "getting-started",
    title: "Getting started",
    body: [
      "Install FolderLink with one command, then leave the window open.",
      "Windows: irm https://folderlink.muiz.pk/install.ps1 | iex",
      "macOS and Linux: curl -fsSL https://folderlink.muiz.pk/install.sh | sh",
      "The app opens your browser to connect this computer. Sign in with Google and choose Allow.",
      "On the dashboard, choose Add folder and pick a project. The path stays on this computer. Only the folder name is stored.",
    ],
  },
  {
    slug: "chatgpt",
    title: "Connect ChatGPT",
    body: [
      "In ChatGPT, open Settings, then Apps or Connectors, and add a custom connector.",
      "Use the MCP address https://folderlink.muiz.pk/mcp.",
      "ChatGPT opens FolderLink to ask for read-only access. Choose Allow.",
      "Ask it to read a file in a folder you turned on. A folder that is paused, or a secret such as .env, is refused.",
    ],
  },
  {
    slug: "claude",
    title: "Connect Claude",
    body: [
      "In Claude, add a custom connector and set the MCP address to https://folderlink.muiz.pk/mcp.",
      "Sign in with the same Google account you used for FolderLink and allow read-only access.",
      "Claude can then list and read files in folders you have approved.",
    ],
  },
  {
    slug: "security",
    title: "Security",
    body: [
      "The laptop dials out. Nothing on it accepts incoming connections.",
      "FolderLink can read files. It cannot write them or run commands.",
      "You choose each folder. Pausing a folder or disconnecting the computer stops new reads.",
      "Names such as .env, private keys, and certificates are refused on the laptop.",
      "Report a vulnerability to the address in SECURITY.md. Do not include file contents.",
    ],
  },
  {
    slug: "self-hosting",
    title: "Self-hosting",
    body: [
      "The hosted service is folderlink.muiz.pk. You can run the same worker on your Cloudflare account.",
      "From a checkout, run pnpm setup and follow the printed commands. pnpm setup --apply runs them.",
      "Create the D1 database, paste its id into wrangler.toml, set the Google sign-in secrets, apply migrations, and deploy.",
      "Point the laptop at your host with folderlink --server https://your-host.",
    ],
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    body: [
      "If the browser does not open, copy the pair address printed in the FolderLink window.",
      "If Add folder says the computer is not connected, leave the FolderLink window open and try again.",
      "If ChatGPT cannot connect, confirm the address is https://folderlink.muiz.pk/mcp and that you chose Allow.",
      "A paused folder or a disconnected computer returns an error instead of file contents.",
      "The checksum check fails closed. Download again if install.ps1 or install.sh reports a mismatch.",
    ],
  },
] as const;

export function Docs() {
  const { slug } = useParams();
  const page = PAGES.find((item) => item.slug === slug) ?? PAGES[0];
  usePageTitle(`${page.title} · FolderLink`);
  if (slug && !PAGES.some((item) => item.slug === slug)) {
    return <Navigate to="/docs/getting-started" replace />;
  }
  return (
    <div className="legal docs">
      <header className="top">
        <div className="top-inner">
          <Link to="/" aria-label="FolderLink home">
            <Mark />
          </Link>
          <Link className="signin" to="/pair">
            Connect
          </Link>
        </div>
      </header>
      <div className="docs-layout">
        <nav className="docs-nav" aria-label="Docs">
          {PAGES.map((item) => (
            <Link
              key={item.slug}
              to={`/docs/${item.slug}`}
              aria-current={item.slug === page.slug ? "page" : undefined}
            >
              {item.title}
            </Link>
          ))}
        </nav>
        <article className="legal-main docs-article">
          <h1>{page.title}</h1>
          {page.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </article>
      </div>
      <SiteFooter />
    </div>
  );
}
