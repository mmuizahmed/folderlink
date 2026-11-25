# Releasing FolderLink

`.goreleaser.yaml` builds `folderlink` for linux, darwin, and windows on amd64 and arm64. `CGO_ENABLED=0`, `-trimpath`, and `-s -w`. A local stripped linux/amd64 build of phase 1 was 5,771,416 bytes, under the 6 MB target.

Pushing a tag that starts with `v` runs `.github/workflows/release.yml`, including a tag on a pull-request branch. That workflow pins GoReleaser to v2.20.3. Archive names leave the version out (`folderlink_linux_amd64.tar.gz`) so `/releases/latest/download/` keeps working. A tag such as `v0.1.0-beta.1` is still published as a normal release, not a pre-release, because GitHub's `latest` download ignores pre-releases.

Release notes are generated automatically from the commits since the last tag (see `changelog` in `.goreleaser.yaml`), so there is nothing to write per tag. Archives are tar.gz, and zip on Windows. `checksums.txt` is published next to them.

## Signing

Archives are not signed. Cosign needs a key this repository does not have, and the free GoReleaser build cannot skip a `signs` block conditionally. `checksums.txt` is still published so downloads can be checked with `sha256sum`.
