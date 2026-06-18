import { mkdirSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** Default per-user root for pure-chat sandbox workspaces.
 *  Honors HIP_SCRATCH_ROOT (injected by the Tauri shell so the cross-platform
 *  root is authoritative); falls back to ~/.hip/scratch for standalone runs. */
export function defaultScratchRoot(): string {
  const fromEnv = process.env.HIP_SCRATCH_ROOT?.trim()
  if (fromEnv) return fromEnv
  return path.join(os.homedir(), '.hip', 'scratch')
}

/** Deterministic scratch dir path for a session. Rejects ids that aren't a single safe path segment. */
export function scratchDirFor(sessionId: string, root: string = defaultScratchRoot()): string {
  if (!sessionId || sessionId.includes('/') || sessionId.includes('\\') || sessionId.includes('..')) {
    throw new Error(`invalid scratch session id: ${sessionId}`)
  }
  return path.join(root, sessionId)
}

/** Create (recursively) and return the scratch dir. Synchronous so callers stay sync. */
export function ensureScratchDir(sessionId: string, root: string = defaultScratchRoot()): string {
  const dir = scratchDirFor(sessionId, root)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Best-effort removal of a session's scratch dir (no-op if absent). */
export function removeScratchDir(sessionId: string, root: string = defaultScratchRoot()): void {
  rmSync(scratchDirFor(sessionId, root), { recursive: true, force: true })
}

/** True iff `cwd` is exactly this session's scratch dir (the pure-chat sandbox), under `root`.
 *  Never throws — a bad/empty id or path simply yields false. */
export function isScratchCwd(cwd: string | undefined, sessionId: string, root: string = defaultScratchRoot()): boolean {
  if (!cwd) return false
  try {
    return path.resolve(cwd) === path.resolve(scratchDirFor(sessionId, root))
  } catch {
    return false
  }
}
