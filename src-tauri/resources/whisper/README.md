# whisper-cli (voice engine)

Models (`~/.hip/models/whisper/`) and the **engine binary** are separate.
Downloading a model never installs the engine.

## Release packages

`yarn package:macos` / `yarn package:windows` **bundle whisper-cli by default**
(`HIP_BUNDLE_WHISPER` defaults to `1`). Models still download on demand in Settings.

- Skip engine in a slim package: `HIP_BUNDLE_WHISPER=0 yarn package:macos`
- Force rebuild: `HIP_WHISPER_REBUILD=1 yarn package:macos`

Layout after `scripts/make-whisper-bin.sh`:

```
resources/whisper/<target-triple>/whisper-cli
```

Do not commit binaries (gitignored). Packaging stages them before `tauri build`.

## Local / dev (no release bundle)

```bash
# macOS — Homebrew
brew install whisper-cpp

# or build + stage into resources + ~/.hip/bin
./scripts/make-whisper-bin.sh

# faster dogfood copy from brew into resources
HIP_WHISPER_SOURCE=brew ./scripts/make-whisper-bin.sh
```

hip resolves: `HIP_WHISPER_BIN` → `~/.hip/bin` → app resources → Homebrew prefixes → `PATH`.
