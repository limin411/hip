# Docker harness spike (illustrative)

**Product CLI is attach-only** and requires a running hip desktop app.

Isolated headless container runs are **not** the product path. For monorepo
dev isolation only:

```bash
HIP_CLI_DEV_SPAWN=1 yarn cli:dev run --stream none --json "pong"
```

**Not production-ready.** `Dockerfile.illustrative` documents a future
shape if a separate headless host is ever productized (out of scope for v1).
