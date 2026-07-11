import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

/**
 * Resolve a stable project key for memory scoping.
 * Prefer git toplevel (`git -C cwd rev-parse --show-toplevel`) then realpath;
 * else realpath(cwd). Hash is sha256(utf8(projectKey)) hex.
 */
export function resolveProjectKey(cwd: string): { projectKey: string; projectKeyHash: string } {
  let root: string | undefined
  try {
    const out = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (out) root = out
  } catch {
    root = undefined
  }
  const base = root ?? cwd
  let projectKey: string
  try {
    projectKey = realpathSync(base)
  } catch {
    projectKey = base
  }
  return { projectKey, projectKeyHash: sha256Hex(projectKey) }
}
