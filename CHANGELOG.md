# Changelog

All notable changes to **hip** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Flat design visual overhaul** (`docs/flat-design-spec.md`):
  - Surfaces are solid — native window vibrancy (macOS Sidebar / Win11 Mica /
    Win10 Acrylic) removed; window theme sync kept. `data-vibrancy` is always `solid`.
  - Hierarchy via 1px borders and value steps instead of shadows/translucency:
    radii 2–6px (buttons/inputs 2px, cards 4px, overlays 6px), `shadow-panel` /
    `shadow-menu` removed, overlay shadow weakened to one light tier.
  - Effort-max holographic chrome flattened to solid purple (no shimmer/glow/pulse).
  - Motion is fade-only and fast: durations 100/120/200ms, no translate/scale,
    no springy easing; `active:scale-*` removed; send/stop and jump-to-latest
    buttons are square (rounded-md) instead of round.
  - Scrims are plain (no backdrop blur); avatar gradient replaced with solid accent.
- Fixed pre-existing issues blocking `yarn tsc`: duplicated whiteboard export keys
  in en/ja/ko/zh-CN i18n, unused `emptySel` in knowledgeStore tests, and a `never`
  type in boardOps tests.

### Added

- **Composer voice dictation** (local [whisper.cpp](https://github.com/ggml-org/whisper.cpp)):
  opt-in in Settings → Voice (default off). Model download + status check for
  tiny/base/small under `~/.hip/models/whisper/`; mic appears only when enabled.
  **Release packages bundle `whisper-cli` by default** (`yarn package:macos` /
  `package:windows`; opt out with `HIP_BUNDLE_WHISPER=0`). Models are still not
  shipped — download in Settings. Dev can use Homebrew or `scripts/make-whisper-bin.sh`
  (`docs/design/composer-voice-input-whisper.md`). Audio stays on-device; no cloud ASR.
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
