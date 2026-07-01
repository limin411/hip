# CLAUDE.md

Behavioral guidelines and project context for hip.
User instructions here override skills and default behavior.

Tradeoff: These guidelines bias toward caution
over speed. For trivial tasks, use judgment.

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

## Project-specific gotchas

- API keys are stored as plaintext `~/.hip/config/auth.json` (0600) by design; do not “fix” this back to a keychain.
- `vitest run src …` substring-matches `packages/sidecar/src` and can fire paid real-LLM tests. To guarantee paid-free, temporarily move `~/.hip/config/auth.json` aside before running `yarn test`.
- System bash is 3.2.57; always brace variables `${var}` before CJK punctuation or when `set -u` is used in UTF-8 locales.
- Stale `rw.*.dmg` mounts can break `yarn tauri build`; fix by removing `rw.*.dmg` and detaching `/Volumes/hip`.

## 1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them.
- If a simpler approach exists, say so.
- If something is unclear, stop. Name what's confusing.
- Look up information online promptly; never trust your own knowledge.

## 2. Simplicity First
Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No “flexibility” that wasn't requested.
- No error handling for impossible scenarios.
- If 200 lines could be 50, rewrite it.

## 3. Surgical Changes
Touch only what you must. Clean up only your own mess.

- Don't “improve” adjacent code or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice dead code, mention it — don't delete it.

## 4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- “Add validation” → “Write tests, then make them pass”
- “Fix the bug” → “Reproduce it in a test, then fix”
- “Refactor X” → “Ensure tests pass before and after”
- Commit code promptly after completing each phase of work.