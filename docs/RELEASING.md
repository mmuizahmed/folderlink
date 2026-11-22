# Releasing the bridge

`.goreleaser.yaml` builds `mcp-bridge` for linux, darwin, and windows on amd64 and arm64. `CGO_ENABLED=0`, `-trimpath`, and `-s -w`. A local stripped linux/amd64 build of phase 1 was 5,771,416 bytes, under the 6 MB target.

Tag `vX.Y.Z` and run the Release workflow, or `goreleaser release` from a checkout of that tag. The workflow is manual and is not run by pull requests.

Archives are tar.gz, and zip on Windows. `checksums.txt` is published next to them.

## Signing

The `signs` block runs `cosign sign-blob` only when `COSIGN_YES` is set. Without that variable, goreleaser skips signing. Set `COSIGN_YES` and provide the cosign key environment the `cosign` binary expects before treating a release as signed. The workflow does not invent a signature when those are absent.
