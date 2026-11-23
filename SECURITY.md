# Security policy

## Reporting

Please report vulnerabilities privately to security@muiz.pk. Include the version, the component (bridge, worker, or panel), and a way to reproduce the issue. Do not open a public issue for a vulnerability, and do not include file contents from a real project.

We will acknowledge the report and keep you updated while it is fixed.

## Supported versions

Phase 1 is the current line. Fixes land on `main`.

## Scope

In scope: path containment bugs, authentication and token handling, cross-user device routing, and secret leakage through tool results or logs.

Out of scope: a file the user explicitly allowlisted and approved, and a compromised server reading folders the bridge was configured to expose. Those are described in [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md).
