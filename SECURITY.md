# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| `1.x` (current `main` / latest release) | Yes |
| Older unreleased git commits | Best-effort only |

Security fixes land on the active development branch and are included in the next release when practical.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Prefer one of:

1. **GitHub Security Advisories** (preferred)  
   On the repository page: **Security → Report a vulnerability**  
   (Requires [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) to be enabled for the repo.)

2. **Private contact**  
   If advisories are unavailable, email the maintainer listed in the repository profile / `NOTICE` (Copyright 2026 ljm) with a clear subject such as `[hip security]`.

Please include:

- Affected version or commit hash
- OS / platform (e.g. macOS 15 arm64)
- Impact (data exposure, RCE, privilege, SSRF, path escape, etc.)
- Minimal reproduction steps or a proof of concept
- Whether the issue is already public elsewhere

## What to expect

- Acknowledgement when maintainers are available (target: within **7 days**)
- Status updates while the issue is investigated
- Coordinated disclosure after a fix is available when possible

We may ask for more detail or a minimal test case. Please do not demand a bounty; this project does not currently run a paid bug bounty.

## Scope (examples)

In scope:

- Path traversal or sandbox escape in file / shell tools
- Leakage of API keys from `~/.hip/config/auth.json` or logs
- Unauthenticated local IPC / WebSocket abuse that escalates beyond the desktop user
- Supply-chain issues in release artifacts produced by this repository
- SSRF or network-policy bypasses in hip’s outbound request layer

Out of scope (report only if there is a clear hip bug):

- Vulnerabilities only in third-party LLM providers or external ACP agents
- Issues that require the user to deliberately disable security settings (e.g. `forwardMcp = true` with untrusted MCP servers) without a product bug
- Social engineering, physical access, or compromised user accounts

## Safe handling of secrets

- LLM API keys are stored in plaintext under `~/.hip/config/auth.json` (mode `0600` by design). **Do not** commit this file or sync `~/.hip/config/` to public cloud/dotfile repos.
- Never paste real API keys into issues, PRs, or public Gists. Redact logs.

## Security-related product notes

- Window close may **quit** or **hide to tray** depending on Settings / `[window]` in `hip.toml` (see README).
- ACP MCP forwarding (`[acp] forwardMcp`) defaults to **false** so hip does not silently pass MCP env/headers to external agents.
- Release builds that use macOS private APIs for window effects are **not** App Store eligible (see `src-tauri` comments).

Thank you for helping keep hip and its users safe.
