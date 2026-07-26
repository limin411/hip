# whisper-cli (voice engine)

Models (`~/.hip/models/whisper/`) and the **engine binary** are separate.
Downloading a model never installs the engine.

## Scenario matrix

| Scenario | How the engine is obtained | Library layout |
|----------|---------------------------|----------------|
| **macOS production** (`yarn package:macos`) | Bundled by default (`HIP_BUNDLE_WHISPER=1`) via `scripts/make-whisper-bin.sh` | Self-contained under `resources/whisper/<triple>/` — CLI **+** dylibs, `@loader_path` fixed |
| **Windows production** (`yarn package:windows`) | Bundled by default via `scripts/make-whisper-bin.ps1` | `whisper-cli.exe` **+** DLLs in the **same** folder |
| **Development** (`yarn tauri dev`) | Not required to rebuild: use Homebrew / PATH, or stage once | Prefer system install with working rpath; avoid bare copies into `~/.hip/bin` |

### Resolution order (runtime)

1. `HIP_WHISPER_BIN` (explicit override)
2. **App resources** `whisper/<triple>/` (production packages)
3. System installs (Homebrew `opt/whisper-cpp`, PATH) when libs resolve
4. `~/.hip/bin` only if libs resolve (orphan brew *copies* are skipped)
5. Dev fallbacks (DYLD_FALLBACK / adjacent PATH)

Production machines must not depend on Homebrew.

## Production packaging

```bash
# macOS release (default builds engine from scripts/whisper-version.txt)
yarn package:macos

# Slim package without engine
HIP_BUNDLE_WHISPER=0 yarn package:macos

# Force rebuild staged engine
HIP_WHISPER_REBUILD=1 yarn package:macos
```

```powershell
# Windows release
yarn package:windows
# or
$env:HIP_BUNDLE_WHISPER='1'; powershell -File scripts/package-windows.ps1
```

Staged layout:

```
resources/whisper/<target-triple>/
  whisper-cli          # or whisper-cli.exe
  libwhisper*.dylib    # macOS — same directory
  *.dll                # Windows — same directory
```

Do **not** commit binaries (gitignored). Packaging stages them before `tauri build`.

## Development

### macOS (recommended)

```bash
brew install whisper-cpp
# hip resolves /opt/homebrew/opt/whisper-cpp/bin/whisper-cli (libs in ../lib)
yarn tauri dev
```

Optional local stage (self-contained, same as production):

```bash
./scripts/make-whisper-bin.sh                 # cmake pin
HIP_WHISPER_SOURCE=brew ./scripts/make-whisper-bin.sh   # dogfood from brew + fix rpaths
```

`make-whisper-bin` installs a **safe** `~/.hip/bin/whisper-cli`:

- brew source → **symlink** to Homebrew (never a bare copy)
- build source → copy CLI **+** dylibs with `@loader_path` fixups

### Windows (dev)

```powershell
# Build once into resources + %USERPROFILE%\.hip\bin
powershell -File scripts/make-whisper-bin.ps1
yarn tauri dev
```

Or set:

```powershell
$env:HIP_WHISPER_BIN = "C:\path\to\whisper-cli.exe"
```

### Override

```bash
export HIP_WHISPER_BIN=/absolute/path/to/whisper-cli
```

## Models

Still on-demand only (`~/.hip/models/whisper/`). Settings → Voice → download.
