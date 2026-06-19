import { mkdirSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** Default worktrees directory — centralized outside the project for safety
 *  (per Karl Weinmeister's worktree safety rule).
 *  Overridable via HIP_WORKTREES_DIR (injected by Rust shell). */
function defaultWorktreesDir(): string {
  return path.join(os.homedir(), '.hip', 'worktrees')
}

/** Ensure the worktrees directory exists, creating parents as needed. */
export function ensureWorktreesDir(): void {
  const dir = process.env.HIP_WORKTREES_DIR?.trim() || defaultWorktreesDir()
  mkdirSync(dir, { recursive: true })
}

/** Read HIP_WORKTREES_DIR from env, ensure it exists, return absolute path.
 *  Falls back to ~/.hip/worktrees/ when env var is unset. */
export function getWorktreesDir(): string {
  const dir = process.env.HIP_WORKTREES_DIR?.trim() || defaultWorktreesDir()
  mkdirSync(dir, { recursive: true })
  return path.resolve(dir)
}
