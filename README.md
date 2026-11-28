<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-lockup.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/brand/logo-lockup-light.svg">
    <img alt="FolderLink" src="docs/brand/logo-lockup.svg" height="64">
  </picture>
  <p><strong>Your folders. Your AI.</strong></p>
  <p>Let ChatGPT, Claude and other AI apps read the project folders you choose, right from their website. No uploads, no copy-paste. Approved, logged, and revocable in one click.</p>
  <p>
    <a href="https://github.com/mmuizahmed/folderlink/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/mmuizahmed/folderlink/actions/workflows/ci.yml/badge.svg"></a>
    <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-22c55e"></a>
    <a href="https://github.com/mmuizahmed/folderlink/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/mmuizahmed/folderlink?label=release"></a>
    <a href="https://go.dev/"><img alt="Go 1.22" src="https://img.shields.io/badge/go-1.22-00ADD8"></a>
    <a href="https://m8ven.ai/mcp/mmuizahmed/folderlink?s=readme"><img alt="M8ven Verified" src="https://m8ven.ai/badge/mcp/mmuizahmed/folderlink?variant=verified"></a>
  </p>
  <p>
    <a href="https://folderlink.muiz.pk">Website</a>
    ·
    <a href="docs/ARCHITECTURE.md">Docs</a>
    ·
    <a href="docs/SELF-HOSTING.md">Self-host</a>
    ·
    <a href="SECURITY.md">Security</a>
  </p>
</div>

<img alt="FolderLink dashboard" src="docs/images/dashboard-hero.png" width="880">

## Why FolderLink

- You stop pasting whole projects into a chat.
- A file leaves your laptop only when an AI app asks for it.
- Secrets such as `.env`, keys, and certificates are always blocked.
- It works with the free ChatGPT plan. No extra subscription.

## How it works

1. Install FolderLink. It runs in the background and opens your browser to connect this computer.
2. Sign in with Google, allow the computer, and add a folder from the dashboard.
3. Add the connector in ChatGPT or Claude. The address is `https://folderlink.muiz.pk/mcp`.

```mermaid
flowchart LR
  laptop[FolderLink on your laptop]
  cloud[folderlink.muiz.pk]
  agent[ChatGPT or Claude]
  folders[Folders you allowed]
  laptop -->|stays connected| cloud
  agent -->|asks to read a file| cloud
  cloud -->|passes the request along| laptop
  laptop --> folders
```

Your laptop calls out. Nothing on it accepts incoming connections. The AI app never picks a device. Your sign-in decides which laptop answers.

| Landing                             | Pair                                   |
| ----------------------------------- | -------------------------------------- |
| ![Landing](docs/images/landing.png) | ![Pair a device](docs/images/pair.png) |

## Install

Windows:

```powershell
irm https://folderlink.muiz.pk/install.ps1 | iex
```

macOS and Linux:

```bash
curl -fsSL https://folderlink.muiz.pk/install.sh | sh
```

The installer checks `checksums.txt`, puts FolderLink in your user directory, and opens the browser to connect this computer. Add a folder from the dashboard. In ChatGPT or Claude, add `https://folderlink.muiz.pk/mcp`.

Or install by hand from [GitHub Releases](https://github.com/mmuizahmed/folderlink/releases): download the archive for your computer (on Windows, `folderlink_windows_amd64.zip` — or `folderlink_windows_arm64.zip` on Arm — which holds both the app and the background service), unzip into one folder, and run `folderlink install` — not `folderlink` on its own. Running `folderlink` directly opens a terminal window, and the connection dies when you close it. `folderlink install` copies the app to a stable folder, starts it at login, and shows a FolderLink icon in the system tray (Windows) — click it for the connection status, the dashboard, restart, or quit. No terminal window. If something looks wrong, run `folderlink doctor`.

```mermaid
sequenceDiagram
  participant App as FolderLink
  participant Site as folderlink.muiz.pk
  participant You
  App->>Site: Ask for a pairing code
  App->>You: Open /pair?code=...
  You->>Site: Sign in with Google and Allow
  App->>Site: Stay connected
```

```mermaid
sequenceDiagram
  participant AI as ChatGPT or Claude
  participant Site as folderlink.muiz.pk
  participant App as FolderLink
  AI->>Site: Read a file, with an OAuth token
  Site->>Site: The token names the account
  Site->>App: Pass the read to that computer
  App->>App: Allow the folder, refuse secrets
  App-->>AI: File contents, or a refusal
```

## Security

- Writes and commands exist, but only behind dashboard approval: every write needs your approval here first, and commands run only from an allowlist.
- The folder list is enforced on your laptop. The server cannot add a path.
- `.env`, keys, and certificates are refused by default.
- The laptop holds an Ed25519 device key. The server checks it on every connection.
- AI apps sign in with OAuth. You can disconnect an app or a computer from the website.

Report a vulnerability through [SECURITY.md](SECURITY.md). The longer threat model is [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md).

## Self-hosting

FolderLink runs on a free Cloudflare account: one Worker, one database, and the website as static files. `pnpm setup` prints the commands. The notes are in [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md).

## Development

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

Local worker, pairing, and MCP Inspector steps are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Project structure

| Path              | What it is                                                       |
| ----------------- | ---------------------------------------------------------------- |
| `apps/bridge`     | The FolderLink app. Pairing, reconnect, and the folder boundary. |
| `apps/worker`     | Cloudflare Worker. One record per laptop, plus the database.     |
| `apps/web`        | Website: landing, pair, and dashboard.                           |
| `packages/shared` | Message format shared by the website and the worker.             |
| `docs`            | Architecture, security, self-hosting, and the roadmap.           |

## Roadmap

Shipped: writing files, running commands, and asking before each action. The list is [docs/ROADMAP.md](docs/ROADMAP.md).

## License

[MIT](LICENSE).
