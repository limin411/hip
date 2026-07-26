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

### Voice engine (whisper-cli)

Release packages **include** a **self-contained** speech engine by default.
Models stay on-demand.

| Scenario | Engine | Models |
|----------|--------|--------|
| **macOS production** (`yarn package:macos`) | Bundled under `resources/whisper/<triple>/` with dylibs + `@loader_path` fixups | Download in Settings |
| **Windows production** (`yarn package:windows`) | Bundled `whisper-cli.exe` + adjacent DLLs | Download in Settings |
| **Development** | Not bundled by default; use Homebrew / `make-whisper-bin` / `HIP_WHISPER_BIN` | Download in Settings |

| | Engine | Models |
|--|--------|--------|
| Release package | Bundled (`HIP_BUNDLE_WHISPER` defaults to `1`) | **Not** bundled |
| End-user machine | No Homebrew required | `~/.hip/models/whisper/` |

Requirements for packaging with engine (default):

- **macOS**: `cmake`, git, Xcode CLT (`HIP_WHISPER_SOURCE=build` is the release default).  
  Optional dogfood only: `HIP_WHISPER_SOURCE=brew` after `brew install whisper-cpp` (script still rewrites rpaths into a self-contained tree).
- **Windows**: `cmake`, MSVC build tools, git (`make-whisper-bin.ps1` copies `whisper*.dll` / `ggml*.dll` next to the exe).

**Critical packaging rule:** never ship a bare `whisper-cli` copied from Homebrew without its libraries.  
`@rpath/libwhisper` with `LC_RPATH=@loader_path/../lib` fails on customer machines and for orphan `~/.hip/bin` copies. Staging always co-locates libs and runs `install_name_tool` on macOS.

Opt out (slimmer artifact; voice needs a system engine at runtime):

```bash
HIP_BUNDLE_WHISPER=0 yarn package:macos
```

```powershell
$env:HIP_BUNDLE_WHISPER = '0'
yarn package:windows
```

Force rebuild of a previously staged binary:

```bash
HIP_WHISPER_REBUILD=1 yarn package:macos
```

Pin is `scripts/whisper-version.txt`. Staged files are gitignored under `src-tauri/resources/whisper/<triple>/`.

See also `src-tauri/resources/whisper/README.md` for the full scenario matrix and resolution order.

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
