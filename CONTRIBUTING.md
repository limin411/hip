# Contributing to hip

Thanks for helping improve **hip** — a local-first desktop AI workbench (Tauri + React + Node sidecar).

By participating, you agree to follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Ways to contribute

- Bug reports and reproducible test cases
- Documentation and localization fixes
- Small, focused pull requests (prefer one concern per PR)
- Design discussion via issues before large refactors

Security vulnerabilities: see [SECURITY.md](./SECURITY.md) — **do not** file public issues.

## Development setup

### Prerequisites

| Tool | Notes |
|------|--------|
| **Node.js** | **≥ 22.5** (prod sidecar / `node:sqlite`; see [`.nvmrc`](./.nvmrc)) |
| **Yarn** | Classic workspaces (`yarn` 1.x). Use the repo `yarn.lock`. |
| **Rust** | Stable toolchain (see [`rust-toolchain.toml`](./rust-toolchain.toml)) |
| **Tauri v2 platform deps** | Follow [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS |

### Quick start

```bash
# 1. Clone and install
git clone https://github.com/limin411/hip.git
cd hip
yarn install

# 2. Dev sidecar wrapper (required; binaries/ is gitignored)
yarn sidecar:dev-bin

# 3. Run desktop app (Vite + sidecar + Tauri)
yarn tauri dev
```

Then open **Settings**, add a provider API key, and start a **Code** or **Chat** session.

API keys are stored in `~/.hip/config/auth.json` (mode `0600`).  
**Never commit keys** or sync `~/.hip/config/` to public cloud/dotfile repos.

Optional config reference (no secrets): [`docs/examples/hip.toml.example`](./docs/examples/hip.toml.example).

### Useful commands

| Command | Purpose |
|---------|---------|
| `yarn type-check` | Frontend TypeScript |
| `yarn workspace @hip/protocol type-check` | Shared protocol types |
| `yarn workspace @hip/sidecar type-check` | Sidecar TypeScript |
| `yarn test` | Vitest unit / contract tests |
| `yarn test:e2e:smoke` | Desktop smoke e2e (needs built app) |
| `yarn test:e2e:gate` | Pre-merge desktop gate (smoke/core/harness/memory/panel/settings/voice) |
| `yarn test:e2e:full` | Full unpaid desktop e2e (excludes `@live`) |
| `yarn product:content` | Regenerate product embeds after editing `packages/product-content/` |
| `yarn product:content:check` | CI-style check that embeds are up to date |
| `yarn package:macos` | Signed macOS `.app` + `.dmg` (needs Developer ID) |
| `HIP_SKIP_SIGN=1 yarn package:macos` | Unsigned macOS package (CI / dogfood) |
| `yarn package:windows` | Windows NSIS installer |
| `cargo test` (in `src-tauri/`) | Rust unit tests |

CI workflows:

| Workflow | Purpose |
|----------|---------|
| [`.github/workflows/test.yml`](./.github/workflows/test.yml) | Type-check, unit, rust, e2e gate (+ full unpaid on main/nightly) |
| [`.github/workflows/build.yml`](./.github/workflows/build.yml) | macOS + Windows production-layout packages (artifacts) |

Paid / real-LLM tests are skipped when no keys are present.  
Note: `vitest run src …` can substring-match `packages/sidecar/src` and accidentally run paid tests; prefer `yarn test` or move `auth.json` aside for a guaranteed key-free run.

### Project layout

```
src/                 React UI
src-tauri/           Tauri / Rust shell
packages/protocol/   Shared WS / config types
packages/sidecar/    LangGraph agent runtime (Node)
packages/cli/        Attach-only CLI for a running app
packages/product-content/  Agent product skill embeds + Help locales
```

Agent-oriented notes for this repo: [`AGENTS.md`](./AGENTS.md), [`CLAUDE.md`](./CLAUDE.md).

## Branch and PR workflow

1. Branch from the active development branch (**`dev`**) unless maintainers ask otherwise.  
   Stable history may live on **`main`**; CI runs on both.
2. Keep diffs **surgical** — no drive-by refactors or unrelated formatting.
3. Match existing code style (TypeScript, Rust, TOML). See [`.editorconfig`](./.editorconfig).
4. Add or update tests when behavior changes.
5. If you edit `packages/product-content/**`, run `yarn product:content` and commit regenerated embeds.
6. Open a PR against `dev` (or the branch maintainers specify). Fill in the PR template.

### PR checklist (summary)

- [ ] `yarn type-check` (and relevant workspace type-checks) pass
- [ ] `yarn test` passes for touched areas
- [ ] No secrets, real API keys, or `~/.hip` dumps
- [ ] User-facing strings: update `src/i18n/*` when needed
- [ ] Docs / README only if the change is user-visible

## Commit messages

Prefer short, imperative subjects (this repo often uses Conventional Commits):

```
fix(work-items): keep modal open when picking dates
test(e2e): exercise DateField via pointerdown
chore: relicense project as MIT
```

## Reporting bugs

Use the **Bug report** issue template. Include:

- hip version or git commit
- OS / arch
- Steps to reproduce
- Expected vs actual
- Relevant logs from `~/.hip/logs/` (redact keys)

## License

Contributions are licensed under the project [MIT License](./LICENSE).  
Copyright for the project is held as described in [`NOTICE`](./NOTICE) (Copyright 2026 ljm), unless a contribution agreement says otherwise.

## Questions

Open a normal issue for product/design questions, or start a discussion if the maintainers enable GitHub Discussions.
