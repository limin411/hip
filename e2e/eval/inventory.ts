import { execFileSync } from 'node:child_process'
import type { ChangeInventory } from './types.js'

function runGit(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    }).trimEnd()
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string }
    // git diff returns 1 when differences exist with some flags; prefer stdout
    if (e.stdout != null && String(e.stdout).length > 0) {
      return String(e.stdout).trimEnd()
    }
    return ''
  }
}

function parsePorcelainPaths(porcelain: string): string[] {
  const paths: string[] = []
  for (const line of porcelain.split('\n')) {
    if (!line.trim()) continue
    // XY PATH or XY ORIG -> PATH
    const rest = line.slice(3)
    const arrow = rest.indexOf(' -> ')
    const p = arrow >= 0 ? rest.slice(arrow + 4) : rest
    if (p) paths.push(p.replace(/^"|"$/g, ''))
  }
  return paths
}

/** Paths that are product/runtime noise, not task work (exclude from agent path portrait). */
export function isNoiseInventoryPath(p: string): boolean {
  const n = p.replace(/\\/g, '/')
  if (n === '.hip' || n.startsWith('.hip/')) return true
  // Agent sometimes writes OS-absolute home paths as relative trees under the worktree
  if (n === 'Users' || n.startsWith('Users/')) return true
  if (n === 'home' || n.startsWith('home/')) return true
  return false
}

/**
 * Diff post-run inventory vs post-setup baseline.
 * Restoring fixture dirt to clean HEAD counts as agent work (paths = cleaned files).
 */
export function inventoryDelta(before: ChangeInventory, after: ChangeInventory): ChangeInventory {
  const beforeSet = new Set(before.paths)
  const afterSet = new Set(after.paths)

  const added = after.paths.filter((p) => !beforeSet.has(p))
  // Fixture path fixed back to HEAD → no longer in porcelain
  const cleaned = before.paths.filter((p) => !afterSet.has(p))
  // Still dirty but patch content changed
  const rewritten =
    before.fullPatch !== after.fullPatch ? after.paths.filter((p) => beforeSet.has(p)) : []

  const paths = [...new Set([...added, ...cleaned, ...rewritten])]
    .filter((p) => !isNoiseInventoryPath(p))
    .sort()
  // Noise-only dirt (.hip/, Users/) must not count as agentTouched for soft scoring
  const agentTouched = paths.length > 0

  return {
    dirtyAfter: after.dirtyAfter,
    agentTouched,
    paths,
    fullPatch: after.fullPatch,
    trackedPatch: after.trackedPatch,
  }
}

/**
 * Eval-side inventory: untracked-aware path list + full patch (add -A + cached diff).
 * Does not leave the worktree staged permanently: resets the index after capture when possible.
 */
export function captureInventory(cwd: string): ChangeInventory {
  const porcelain = runGit(cwd, ['status', '--porcelain'])
  const dirtyAfter = porcelain.trim().length > 0

  const nameOnly = runGit(cwd, ['diff', '--name-only', 'HEAD'])
  const nameOnlyCached = runGit(cwd, ['diff', '--cached', '--name-only'])
  const trackedPatch = [runGit(cwd, ['diff', 'HEAD']), runGit(cwd, ['diff', '--cached'])]
    .filter(Boolean)
    .join('\n')

  const paths = new Set<string>()
  for (const p of parsePorcelainPaths(porcelain)) paths.add(p)
  for (const line of nameOnly.split('\n')) {
    if (line.trim()) paths.add(line.trim())
  }
  for (const line of nameOnlyCached.split('\n')) {
    if (line.trim()) paths.add(line.trim())
  }

  // Full patch including untracked
  runGit(cwd, ['add', '-A'])
  const fullPatch = runGit(cwd, ['diff', '--cached'])
  // Restore index/worktree state as agent left it as best-effort:
  // reset keeps working tree; unstages everything
  runGit(cwd, ['reset', 'HEAD'])

  // Re-parse paths from full patch headers if empty
  if (paths.size === 0 && fullPatch) {
    for (const m of fullPatch.matchAll(/^\+\+\+ b\/(.+)$/gm)) {
      paths.add(m[1])
    }
  }

  return {
    dirtyAfter: dirtyAfter || fullPatch.trim().length > 0,
    paths: [...paths].sort(),
    fullPatch,
    trackedPatch,
  }
}
