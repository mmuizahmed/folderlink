const RELEASE = "https://github.com/mmuizahmed/folderlink/releases/latest/download";

// installCommandForThisComputer is the one-line install for this computer:
// PowerShell on Windows, the shell installer everywhere else. It is the
// exact command install.ps1 / install.sh expect — no arguments, piped
// straight into the shell. It mirrors downloadForThisComputer's OS
// detection, including the Linux default when the platform is unknown.
export function installCommandForThisComputer(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  if (/Win/.test(platform) || /Windows/.test(ua)) {
    return "irm https://folderlink.muiz.pk/install.ps1 | iex";
  }
  return "curl -fsSL https://folderlink.muiz.pk/install.sh | sh";
}

export function downloadForThisComputer(): { label: string; href: string } {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  if (/Mac|iPhone|iPad/.test(platform) || /Mac OS/.test(ua)) {
    const appleSilicon = /arm|aarch64/i.test(ua);
    return {
      label: appleSilicon ? "Download for Mac (Apple silicon)" : "Download for Mac",
      href: `${RELEASE}/folderlink_darwin_${appleSilicon ? "arm64" : "amd64"}.tar.gz`,
    };
  }
  if (/Win/.test(platform) || /Windows/.test(ua)) {
    return { label: "Download for Windows", href: `${RELEASE}/folderlink_windows_amd64.zip` };
  }
  const arm = /aarch64|arm64/i.test(ua);
  return {
    label: arm ? "Download for Linux (arm64)" : "Download for Linux",
    href: `${RELEASE}/folderlink_linux_${arm ? "arm64" : "amd64"}.tar.gz`,
  };
}
