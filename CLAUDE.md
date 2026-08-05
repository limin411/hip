# CLAUDE.md

Project-specific context for hip.
User instructions here override skills and default behavior.

For general agent behavioral guidelines, see `AGENTS.md`.

## Project

hip is a Tauri-based desktop AI workbench (Rust core + React/TypeScript UI).
It drives local and remote agents through a sidecar and its own hub loop.

### Stack

- Frontend: React 18, TypeScript, Tailwind CSS, Zustand, Radix UI
- Desktop: Tauri v2 (Rust)
- Sidecar: Node.js TypeScript (`packages/sidecar/`)
- Tests: Vitest (frontend), cargo test (Rust)

## Commands

```bash
# Install dependencies
yarn install

# Start the desktop app in dev mode (restarts are needed for native changes)
yarn tauri dev

# Run frontend tests (paid LLM tests are skipped by default if no key is present)
yarn test

# Type-check and build
yarn tsc
yarn tauri build
```

## Key directories

- `src/` — React UI and domain logic
- `src-tauri/` — Rust Tauri app and native commands
- `packages/sidecar/` — Node.js sidecar that runs agents / tools
- `packages/protocol/` — shared types between UI and sidecar

## Long-task dogfood target

- Repo: `/Users/lijiamin/data/code-repository/project-rust/make-stock-money` (`HIP_EVAL_MSM_PATH`)
- Pack: `e2e/eval/tasks/make-stock-money/` · journal: `docs/design/msm-dogfood-journal.md`
- `eval "$(scripts/hip-eval-bootstrap-msm.sh)"` then `yarn dogfood:msm -- --list` or bind folder in desktop Code surface

## Project-specific gotchas

- API keys are stored as plaintext `~/.hip/config/auth.json` (0600) by design; do not “fix” this back to a keychain.
- `vitest run src …` substring-matches `packages/sidecar/src` and can fire paid real-LLM tests. To guarantee paid-free, temporarily move `~/.hip/config/auth.json` aside before running `yarn test`.
- System bash is 3.2.57; always brace variables `${var}` before CJK punctuation or when `set -u` is used in UTF-8 locales.
- Stale `rw.*.dmg` mounts can break `yarn tauri build`; fix by removing `rw.*.dmg` and detaching `/Volumes/hip`.
- Window close defaults to **quit** (historical). Hide-to-tray is opt-in under **Settings → General → Window & background** (`[window]` in hip.toml). `HIP_TRAY=0` forces quit-on-close. E2E teardown should kill the process, not rely on close=quit if the user enabled hide.
