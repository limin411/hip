/**
 * @internal
 * Internal monorepo / test helpers for `@hip/cli`.
 * Product surface is the `hip` binary (subprocess + `--json`), not a published SDK.
 */
export { runHip, exitCodeOf } from './run.js'
export type {
  HipRunOptions,
  HipRunResult,
  HipRunStatus,
  HitlMode,
  StreamMode,
  PresetName,
} from './types.js'
export { STATUS_EXIT, exitForStatus, mapErrorCode } from './types.js'
export { bootstrapIsolation } from './sidecar/env-bootstrap.js'
export { resolveSidecarEntry, parseHandshakeLine, parseHandshakeFromLog } from './sidecar/resolve-entry.js'
export { pickAllowOptionId, parseInterruptContextKind } from './client/hitl-policy.js'
export { runTurn, waitReady } from './client/turn-runner.js'
export { StreamRenderer } from './client/stream-renderer.js'
export { redactSecrets } from './artifacts/redact.js'
export { captureGitBaseline, captureGitAfter, buildWorktreePatch } from './artifacts/git.js'
export { exportArtifacts } from './artifacts/export.js'
export { connectSidecar, waitForServerMessage } from './sidecar/connect.js'
export { userHipEnv } from './sidecar/user-hip.js'
export { resolveHipBaseDir, resolveDiscoveryPath } from './sidecar/hip-base.js'
export { readDiscovery, DiscoveryError } from './sidecar/discovery.js'
export { CLI_VERSION } from './version.js'
