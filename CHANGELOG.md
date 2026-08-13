# Changelog

All notable changes to **hip** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Terminal ops assistant is builtin-hip-only** (`src/components/terminals/TerminalAgentPanel.tsx`):
  - ACP/external agents are no longer first-class in the ops composer — the agent
    picker is gone and new terminal chats always run the built-in hip agent
    (`startTerminalAgentChat` no longer accepts `agentId`).
  - The composer's left slot now carries the chat/project-style **model switcher**
    (`ModelPicker` bound to the terminal session via `sessionId`;
    `sessionService.setSessionModelFor` targets the bound session, never the
    global active session), next to the permission-mode picker.
  - The ops composer also gained the **thinking intensity (effort) picker**
    (`EffortLevelPicker` bound via `sessionId`, hidden when the model has no
    effort options — chat parity). The left-slot controls are now the shared
    chat components: `ModelPicker` / `EffortLevelPicker` / `PermissionModePicker`
    all accept an optional `sessionId` (same contract) and the local
    `PermissionModeChip` copy in `TerminalAgentPanel` was deleted; the composer
    card's danger border follows the store `permissionMode` echo instead of an
    optimistic local copy.

- **Terminal embeds a subset of JetBrainsMono Nerd Font Mono** (`docs/design/doc-terminal-nerd-fonts/terminal_nerd_font_spec.md`):
  - p10k / starship / lsd / eza style private-use-area icons now render in the
    xterm surface without users installing fonts (≈1.05 MB woff2, both weights).
  - Fonts are loaded before the Terminal opens (timeout-guarded) so first paint
    is not mis-measured; global `--font-code` and code blocks are untouched.
  - Pipeline: `yarn fonts:fetch` (scripts/fetch-nerd-font.mjs + font-manifest.json,
    pinned v3.5.0 with sha256 verification); OFL/MIT license texts ship with the assets.

- **Flat design visual overhaul**:
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

- **Rounded-rectangle radius ladder** (replaces the sharp 2/4/6px scheme):
  buttons/inputs/small controls `rounded-sm` 2→**6px**, cards/bubbles/Composer
  `rounded/md/lg` 4→**10px**, overlays (Modal/dropdowns/palette)
  `rounded-xl/2xl/3xl` 6→**14px**. Single-source change in
  `tailwind.config.js` borderRadius tokens; `rounded-full` stays exclusive to
  avatar / status dots / switch thumbs. DESIGN.md synced.
- Fixed pre-existing issues blocking `yarn tsc`: duplicated whiteboard export keys
  in en/ja/ko/zh-CN i18n, unused `emptySel` in knowledgeStore tests, and a `never`
  type in boardOps tests.
- **Right rail open/close animation** (`src/routes/AppLayout.tsx`, `src/styles/tokens.css`,
  `tailwind.config.js`): the edge drawer now slides open/shut instead of snapping.
  Programmatic toggles animate the rail width via a `flex-grow` transition
  (`.rail-animating`, 300ms `--duration-expand`) on both panels in lockstep; drawer
  content is pinned to a fixed pixel width during the transition so it is clipped
  (drawer slide) instead of reflowing, stays mounted through the exit (fade+slide
  `animate-panel-out`), and unmounts when the transition settles. Drag-resize and
  drag-to-close keep their live (un-animated) behavior; `prefers-reduced-motion`
  collapses the animation via the global motion freeze.

### Added

- **Composer voice dictation** (local [whisper.cpp](https://github.com/ggml-org/whisper.cpp)):
  opt-in in Settings → Voice (default off). Model download + status check for
  tiny/base/small under `~/.hip/models/whisper/`; mic appears only when enabled.
  **Release packages bundle `whisper-cli` by default** (`yarn package:macos` /
  `package:windows`; opt out with `HIP_BUNDLE_WHISPER=0`). Models are still not
  shipped — download in Settings. Dev can use Homebrew or `scripts/make-whisper-bin.sh`.
  Audio stays on-device; no cloud ASR.
- Apache License 2.0 (`LICENSE`, `NOTICE`) and open-source contributor docs
  (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, GitHub issue/PR templates)
- Example config: `docs/examples/hip.toml.example`
- Release notes: `docs/release.md`
- **Extension registry** for plugin / skill / MCP conflict resolution:
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
