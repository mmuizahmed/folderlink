#!/bin/sh
# FolderLink installer for macOS and Linux. No root required.
set -eu

repo="mmuizahmed/folderlink"
os=$(uname -s)
arch=$(uname -m)
case "$os:$arch" in
  Darwin:arm64) asset="folderlink_darwin_arm64.tar.gz" ;;
  Darwin:x86_64) asset="folderlink_darwin_amd64.tar.gz" ;;
  Linux:x86_64) asset="folderlink_linux_amd64.tar.gz" ;;
  Linux:aarch64|Linux:arm64) asset="folderlink_linux_arm64.tar.gz" ;;
  *) echo "FolderLink has no build for $os $arch" >&2; exit 1 ;;
esac

root="${HOME}/.local"
bindir="${root}/bin"
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
base="https://github.com/${repo}/releases/latest/download"
curl -fsSL "${base}/checksums.txt" -o "${tmpdir}/checksums.txt"
curl -fsSL "${base}/${asset}" -o "${tmpdir}/${asset}"
expected=$(awk -v name="$asset" '$0 ~ name { print $1; exit }' "${tmpdir}/checksums.txt")
if [ -z "$expected" ]; then
  echo "checksums.txt has no entry for ${asset}" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "${tmpdir}/${asset}" | awk '{ print $1 }')
else
  actual=$(shasum -a 256 "${tmpdir}/${asset}" | awk '{ print $1 }')
fi
if [ "$actual" != "$expected" ]; then
  echo "checksum mismatch for ${asset}" >&2
  exit 1
fi

mkdir -p "$bindir"
tar -xzf "${tmpdir}/${asset}" -C "$tmpdir"
bin=$(find "$tmpdir" -type f -name folderlink | head -n 1)
if [ -z "$bin" ]; then
  echo "folderlink was not in the archive" >&2
  exit 1
fi
install -m 755 "$bin" "${bindir}/folderlink"

case ":${PATH}:" in
  *":${bindir}:"*) ;;
  *)
    rc="${HOME}/.profile"
    if [ -f "${HOME}/.zshrc" ]; then rc="${HOME}/.zshrc"; fi
    printf '\nexport PATH="%s:$PATH"\n' "$bindir" >> "$rc"
    ;;
esac

echo "FolderLink is installed. Registering it to start at login."
PATH="${bindir}:${PATH}" "${bindir}/folderlink" install
echo "FolderLink is running in the background with no terminal window."
