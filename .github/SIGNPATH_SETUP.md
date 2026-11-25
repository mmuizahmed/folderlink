# SignPath signing setup (for maintainers)

Windows Smart App Control blocks the unsigned `folderlink.exe` outright —
no "Run anyway" button, unlike the SmartScreen warning. The only real fix
is a signed binary. This repo signs its Windows releases with
[SignPath Foundation](https://signpath.org/)'s free program for
open-source projects. The `sign-windows` job in
`.github/workflows/release.yml` does it automatically once the secrets
below exist; until then it is skipped and releases ship unsigned.

## 1. Apply (free, takes days)

1. Go to **https://signpath.org/apply** and apply for the free
   open-source program. Link this repo (`github.com/mmuizahmed/folderlink`,
   MIT license) and describe FolderLink: a self-hosted MCP bridge that lets
   AI apps read folders on the user's own laptop.
2. Wait for approval. New/small projects are sometimes rejected; if that
   happens, keep shipping releases and reapply in a few months.

## 2. Configure the project in the SignPath dashboard

After approval, in the SignPath web console:

1. Create a **Project** with slug `folderlink`.
2. Create an **Artifact Configuration** with slug `windows-exe`:
   - Root element is a **ZIP file** containing one **Portable Executable
     (`.exe`)**. The root must be a zip because `actions/upload-artifact`
     always wraps the uploaded file in a zip before SignPath sees it.
3. Create a **Signing Policy** with slug `release-signing`, bound to the
   SignPath Foundation certificate, with auto-approval for the GitHub
   Actions trusted build system.
4. Under **Trusted Build Systems**, enable the **GitHub Actions**
   connector, and install the **SignPath GitHub App** on this repo — SignPath
   uses it to verify the artifact came from a workflow run in this repo.
5. Create a **CI User** and generate an **API token**.
6. Note the **Organization ID** (a GUID) from the dashboard.

## 3. Add the token and the organization ID to this repo

Repo → Settings → Secrets and variables → Actions:

- **New repository secret** `SIGNPATH_API_TOKEN` — the CI user API token
  from step 2.5.
- **New repository variable** (Variables tab, not Secrets)
  `SIGNPATH_ORGANIZATION_ID` — the Organization ID (GUID) from step 2.6.
  The variable is the switch: the `sign-windows` job only runs when it
  is set, so the token stays secret and the org ID stays visible.

Only the token is secret; the slugs (`folderlink`, `release-signing`,
`windows-exe`) are hard-coded in the workflow.

## 4. How the next release is signed

Push a tag as usual. The `goreleaser` job publishes the release, then the
`sign-windows` job:

1. Downloads the four unsigned Windows zips from the release.
2. Submits each `.exe` to SignPath (pinned action
   `SignPath/github-action-submit-signing-request` v3.2) and waits for
   signing to finish.
3. Re-zips the signed exes (same contents: `LICENSE`, `README.md`, exe),
   regenerates `checksums.txt`, and re-uploads the four zips plus the
   checksums to the release with `--clobber`.

The release page ends up with signed Windows binaries; the macOS/Linux
archives are untouched (code signing is a Windows requirement here).

## 5. What signing does and does not fix

- The signed exe shows publisher **"SignPath Foundation"** (the
  certificate is issued to the Foundation, not to you).
- Signing is necessary but not instantly sufficient for Smart App Control:
  a brand-new publisher has no reputation yet, so the first signed
  releases may still be blocked until downloads accumulate. The only route
  that passes Smart App Control immediately is the Microsoft Store (MSIX).
- Verify a signed binary on Windows with
  `Get-AuthenticodeSignature .\folderlink.exe` in PowerShell, or
  right-click the exe → Properties → Digital Signatures.

## If SignPath rejects the application

Keep shipping unsigned and reapply in 3–6 months once there is a release
history. The fallback options are Azure Artifact Signing (~$9.99/month,
identity validation for individuals is US/Canada only) or a standard OV
certificate (~$129–300/year). See `SMARTSCREEN.md` in
`~/workspace/folderlink-improvements/` for the full comparison.
