# Docker harness spike (illustrative)

See design `2026-07-14-hip-cli-design.md` § Harness / Docker Integration.

**Not production-ready.** `Dockerfile.illustrative` documents the target shape:

1. Runtime image = Node + git + **prebuilt** `cli` + **ncc sidecar** (not full monorepo).
2. Set `HIP_SIDECAR_BIN` to the ncc bundle (today monorepo CLI prefers `tsx` sources because ncc+`node:sqlite` can fail on some Node builds).
3. Mount workspace at `/workspace`, set `--cwd /workspace`.
4. Mount secrets: `HIP_AUTH_PATH` or env `HIP_MODEL_*_API_KEY`.
5. Isolation: entrypoint uses `--preset harness` so `HOME`/`HIP_*` stay under a data volume.

Acceptance for a real image (future):

- [ ] `hip doctor` inside container
- [ ] `hip run --preset harness --stream none --json --output … "pong"` exit 0 with key
- [ ] No write to host `~/.hip` when volume-isolated
