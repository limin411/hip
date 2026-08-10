// packages/sidecar/src/session/turn-diff-tracker.ts
// Per-turn workspace diff summary (G2): after a turn finishes, capture a
// cheap git numstat summary of the workspace so long-task runs can be audited
// ("which turn changed what"). Reuses collectWorkspaceDiffSummary; bounded by
// a hard timeout (default 100ms) — observability must never stall the loop.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { collectWorkspaceDiffSummary } from './workspace-git.js'

export interface TurnDiffSummary {
  files: number
  additions: number
  deletions: number
}

/** True when the cwd looks like a git repo (cheap guard before any git call). */
export function looksLikeGitRepo(cwd: string): boolean {
  if (!cwd) return false
  try {
    return existsSync(join(cwd, '.git'))
  } catch {
    return false
  }
}

/** Promise that resolves to null after `timeoutMs` (unref'd so it never holds the loop). */
function timeoutNull(timeoutMs: number): Promise<null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs)
    t.unref?.()
  })
}

/**
 * Best-effort turn diff summary. Never throws. Returns null when the directory
 * is not a git repo, the diff does not complete within `timeoutMs`, or any git
 * error occurs (all folded into null so callers stay observability-light).
 */
export async function collectTurnDiff(
  cwd: string,
  timeoutMs = 100,
): Promise<TurnDiffSummary | null> {
  if (!looksLikeGitRepo(cwd)) return null
  try {
    const diff = await Promise.race([
      collectWorkspaceDiffSummary(cwd),
      timeoutNull(timeoutMs),
    ])
    if (!diff || diff.state !== 'ok' || !diff.summary) return null
    const s = diff.summary
    if (s.totalFiles === 0 && s.totalAdditions === 0 && s.totalDeletions === 0) return null
    return { files: s.totalFiles, additions: s.totalAdditions, deletions: s.totalDeletions }
  } catch {
    return null
  }
}
