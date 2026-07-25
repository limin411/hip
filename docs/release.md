# Release guide

How maintainers cut a **hip** desktop release. Product version today is coordinated across:

| Location | Field |
|----------|--------|
| `package.json` | `version` |
| `packages/*/package.json` | `version` (keep in sync when releasing) |
| `src-tauri/Cargo.toml` | `version` |
| `src-tauri/tauri.conf.json` | `version` |

## Prerequisites

- Clean git working tree on the intended release commit
- Node 20+, Yarn, Rust stable, platform Tauri deps
- macOS: Xcode CLT; signing/notarization credentials if you distribute signed builds
- Windows: environment capable of running `scripts/package-windows.ps1`

## Version bump

1. Update versions in the files above to the same semver (e.g. `1.0.2`).
2. Add a section under `[Unreleased]` → new version in [`CHANGELOG.md`](../CHANGELOG.md).
3. Commit: `chore: release vX.Y.Z` (or similar).

## Build artifacts

### macOS

```bash
yarn install
yarn release:macos
# or: bash scripts/package-macos.sh
```

Typical outputs under `src-tauri/target/release/bundle/`:

- `macos/hip.app`
- `dmg/hip_*_*.dmg`

Notes from project gotchas:

- Stale `rw.*.dmg` mounts can break builds; remove them and detach `/Volumes/hip` if needed.
- Builds using macOS private APIs for vibrancy are **not** App Store eligible.

### Windows

```powershell
yarn install
yarn release:windows
# or: powershell -ExecutionPolicy Bypass -File scripts/package-windows.ps1
```

## Sidecar / resources

Release packaging expects production sidecar binaries and resources as produced by the package scripts (`sidecar:prod-bin` / script internals). Prefer the release scripts over ad-hoc partial builds unless you know the layout under `src-tauri/binaries` and `src-tauri/resources`.

## GitHub Release checklist

1. Push the release commit / tag (`vX.Y.Z`).
2. Create a GitHub Release from the tag; paste CHANGELOG section.
3. Attach `.dmg` / Windows installer (and checksums if you generate them).
4. Verify download + first-run on a clean machine when possible.

## Smoke after packaging

```bash
# optional: smoke e2e against a debug build (CI uses yarn tauri build --debug)
yarn test:e2e:smoke
```

Kill leftover app processes in e2e teardown if the user enabled hide-to-tray (`[window]`); do not rely on close = quit.

## Third-party notices

This repo does not yet auto-generate a full `THIRD_PARTY_NOTICES` file for every npm/cargo dependency. Before wide binary distribution, consider generating license summaries (`yarn licenses generate-disclaimer`, `cargo about`, or similar) and attaching them to the release.
