import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { resolveDiscoveryPath } from './hip-base.js'

export interface DiscoveryDoc {
  schemaVersion: number
  pid: number
  port: number
  token: string
  startedAt: string
  hipDataDir: string
  appVersion?: string
}

export type DiscoveryErrorCode =
  | 'APP_NOT_RUNNING'
  | 'DISCOVERY_INVALID'
  | 'DISCOVERY_INSECURE'

export class DiscoveryError extends Error {
  constructor(
    readonly code: DiscoveryErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DiscoveryError'
  }
}

function isGroupOrWorldReadable(mode: number): boolean {
  // mode & 0o077 non-zero means group or other has some permission bit.
  return (mode & 0o077) !== 0
}

/**
 * Read and validate product discovery file for attach-only CLI.
 */
export function readDiscovery(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): DiscoveryDoc {
  const path = resolveDiscoveryPath(env, platform)
  if (!existsSync(path)) {
    throw new DiscoveryError('APP_NOT_RUNNING', `hip app is not running (no discovery file at ${path})`)
  }

  if (platform !== 'win32') {
    try {
      const st = statSync(path)
      const mode = st.mode & 0o777
      if (isGroupOrWorldReadable(mode) && env.HIP_CLI_ALLOW_INSECURE_DISCOVERY !== '1') {
        throw new DiscoveryError(
          'DISCOVERY_INSECURE',
          `discovery file is group/other-readable (mode ${mode.toString(8)}); refusing attach`,
        )
      }
    } catch (err) {
      if (err instanceof DiscoveryError) throw err
      // stat failure → treat as not running
      throw new DiscoveryError('APP_NOT_RUNNING', `cannot stat discovery file: ${(err as Error).message}`)
    }
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new DiscoveryError('DISCOVERY_INVALID', `discovery file unreadable: ${(err as Error).message}`)
  }

  if (!raw || typeof raw !== 'object') {
    throw new DiscoveryError('DISCOVERY_INVALID', 'discovery file is not an object')
  }
  const o = raw as Record<string, unknown>
  if (o.schemaVersion !== 1) {
    throw new DiscoveryError(
      'DISCOVERY_INVALID',
      `unsupported schemaVersion ${String(o.schemaVersion)} (expected 1)`,
    )
  }
  const port = Number(o.port)
  const pid = Number(o.pid)
  const token = typeof o.token === 'string' ? o.token : ''
  if (!Number.isFinite(port) || port <= 0 || !token) {
    throw new DiscoveryError('DISCOVERY_INVALID', 'discovery missing port/token')
  }

  // PID heuristic: if process is clearly dead, optional stale unlink then APP_NOT_RUNNING.
  if (Number.isFinite(pid) && pid > 0) {
    try {
      process.kill(pid, 0)
    } catch {
      // Dead — unlink only if content unchanged
      try {
        const bytes = readFileSync(path)
        const again = readFileSync(path)
        if (Buffer.compare(bytes, again) === 0) {
          unlinkSync(path)
        }
      } catch {
        /* ignore race */
      }
      throw new DiscoveryError('APP_NOT_RUNNING', `hip app is not running (stale pid ${pid})`)
    }
  }

  return {
    schemaVersion: 1,
    pid: Number.isFinite(pid) ? pid : 0,
    port,
    token,
    startedAt: typeof o.startedAt === 'string' ? o.startedAt : '',
    hipDataDir: typeof o.hipDataDir === 'string' ? o.hipDataDir : '',
    appVersion: typeof o.appVersion === 'string' ? o.appVersion : undefined,
  }
}

/** Path helper for doctor output. */
export function discoveryPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolveDiscoveryPath(env)
}
