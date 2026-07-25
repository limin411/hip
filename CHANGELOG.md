# Changelog

All notable changes to **hip** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Apache License 2.0 (`LICENSE`, `NOTICE`) and open-source contributor docs
  (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, GitHub issue/PR templates)
- Example config: `docs/examples/hip.toml.example`
- Release notes: `docs/release.md`
- **Extension registry** for plugin / skill / MCP conflict resolution
  (`docs/design/extension-registry.md`):
  - Skill precedence: project > user > plugin > builtin (aligned with Settings / Tauri)
  - MCP: hip.toml id wins (including `enabled = false` name veto); capability
    fingerprint demotes duplicate packages/URLs unless `allowDuplicate = true`
  - Tauri injects `HIP_SKILLS_DIR`; sidecar falls back to `HIP_DATA_DIR/skills` or `~/.hip/skills`
  - Plugin skills/MCP stamp `pluginId` / `scope: 'plugin'` for provenance
  - WS `extension:inspect` / `extension:preflight`; Settings conflict banner with remediations
  - Settings consume registry snapshot (shadowed badges); preflight enable modal
  - CLI: `hip extension inspect [--cwd] [--json]`

## [1.0.1] - 2026-07-25

### Notes

- Current package / Tauri product version at the time open-source scaffolding was added.
- Detailed historical notes for earlier development were not maintained in this file;
  see git history on `dev` / `main` for prior work.

[Unreleased]: https://github.com/limin411/hip/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/limin411/hip/releases/tag/v1.0.1
