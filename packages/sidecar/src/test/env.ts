/**
 * Shared environment probes for sidecar tests.
 *
 * Rule: a test that cannot run here must **self-skip with a stated reason**, never
 * fail. A red suite nobody reads is worse than a skipped test with a comment that
 * says which platform gap it is waiting on.
 */
import { mkdtempSync, rmSync, rm as rmCallback, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const rmAsync = promisify(rmCallback)

export const IS_WIN32 = process.platform === 'win32'
/** POSIX-only fixtures (/bin/sh, /usr/bin/env, unix permission bits). */
export const IS_POSIX = !IS_WIN32

/**
 * Can this process create symlinks?
 *
 * Windows: `fs.symlink` needs either an elevated process or Developer Mode,
 * otherwise EPERM. Probed once at import so symlink-escape tests self-skip
 * instead of reporting a fake security failure.
 */
export const CAN_SYMLINK: boolean = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'hip-symlink-probe-'))
  try {
    symlinkSync(join(dir, 'a'), join(dir, 'b'))
    return true
  } catch {
    return false
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})()

/** Do POSIX permission bits mean anything here? (Windows: no.) */
export const POSIX_MODES = !IS_WIN32

/**
 * Remove a temp tree, retrying through Windows' transient EBUSY.
 *
 * Git / node subprocesses can hold a directory for a few hundred ms after they
 * exit. `fs.rm` retries, but only for a short fixed window. Growing backoff
 * turns a whole class of environment-intrinsic red into a non-event.
 */
export async function rmRetry(target: string, attempts = 6): Promise<void> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      await rmAsync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 30 })
      if (!existsSync(target)) return
      lastErr = new Error(`rmRetry: ${target} still exists`)
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, 40 * (i + 1)))
  }
  throw lastErr
}

/** Sync flavour for `afterEach(() => { ... })` bodies that cannot await. */
export function rmRetrySync(target: string, attempts = 6): void {
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 30 })
      if (!existsSync(target)) return
    } catch {
      /* fall through to backoff */
    }
    const until = Date.now() + 40 * (i + 1)
    while (Date.now() < until) {
      /* deliberate spin: sync API */
    }
  }
}
