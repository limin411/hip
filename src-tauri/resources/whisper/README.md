# Optional whisper-cli binaries

Do not commit large binaries. Build with:

```bash
./scripts/make-whisper-bin.sh
```

Layout: `resources/whisper/<target-triple>/whisper-cli`

Package with `HIP_BUNDLE_WHISPER=1` to include staged binaries (see `scripts/package-macos.sh`).
