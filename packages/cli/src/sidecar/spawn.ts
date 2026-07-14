import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createWriteStream, type WriteStream } from 'node:fs'
import { resolveSidecarEntry, parseHandshakeLine } from './resolve-entry.js'

export interface SpawnSidecarOpts {
  env: NodeJS.ProcessEnv
  parentWatch?: boolean
  handshakeTimeoutMs?: number
  /** Tee child stderr when true. */
  debug?: boolean
  sidecarLogPath?: string
}

export interface SpawnedSidecar {
  child: ChildProcessWithoutNullStreams
  port: number
  token: string
  /** Keep open until shutdown so parent-watch does not EOF early. */
  stdin: NodeJS.WritableStream
  stderrRing: string
  kill: (signal?: NodeJS.Signals) => void
  closeStdin: () => void
}

const DEFAULT_HANDSHAKE_MS = 15_000
const STDERR_RING_MAX = 64 * 1024

/**
 * Spawn sidecar, parse {"port","token"} from stdout, keep stdin write end open.
 */
export async function spawnSidecar(opts: SpawnSidecarOpts): Promise<SpawnedSidecar> {
  const entry = resolveSidecarEntry(opts.env)
  const env: NodeJS.ProcessEnv = {
    ...opts.env,
    ...(opts.parentWatch !== false ? { HIP_PARENT_WATCH: '1' } : {}),
  }

  const child = spawn(entry.command, entry.args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams

  let stderrRing = ''
  let logStream: WriteStream | undefined
  if (opts.sidecarLogPath) {
    logStream = createWriteStream(opts.sidecarLogPath, { flags: 'a' })
  }

  const appendStderr = (chunk: string) => {
    stderrRing = (stderrRing + chunk).slice(-STDERR_RING_MAX)
    if (opts.debug) process.stderr.write(chunk)
    logStream?.write(chunk)
  }

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (d: string) => appendStderr(d))

  const handshake = await new Promise<{ port: number; token: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(Object.assign(new Error('sidecar handshake timeout'), { code: 'HANDSHAKE_TIMEOUT' }))
    }, opts.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_MS)

    let buf = ''
    let settled = false

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(
        Object.assign(
          new Error(`sidecar exited before handshake (code=${code} signal=${signal})\n${stderrRing}`),
          { code: 'SIDECAR_SPAWN_FAILED' },
        ),
      )
    }

    const cleanup = () => {
      child.stdout.off('data', onData)
      child.off('exit', onExit)
      child.off('error', onError)
    }

    const onError = (err: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      cleanup()
      reject(Object.assign(err, { code: 'SIDECAR_SPAWN_FAILED' }))
    }

    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      logStream?.write(text)
      buf += text
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const hit = parseHandshakeLine(line)
        if (hit) {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          cleanup()
          // Keep listening for residual stdout only if needed; detach handshake.
          child.stdout.on('data', (c) => logStream?.write(c))
          resolve(hit)
          return
        }
      }
    }

    child.stdout.on('data', onData)
    child.once('exit', onExit)
    child.once('error', onError)
  })

  const closeStdin = () => {
    try {
      if (!child.stdin.destroyed) child.stdin.end()
    } catch {
      /* ignore */
    }
  }

  const kill = (signal: NodeJS.Signals = 'SIGTERM') => {
    try {
      if (!child.killed) child.kill(signal)
    } catch {
      /* ignore */
    }
  }

  return {
    child,
    port: handshake.port,
    token: handshake.token,
    stdin: child.stdin,
    get stderrRing() {
      return stderrRing
    },
    kill,
    closeStdin,
  }
}

/** Graceful stop: close stdin (parent-watch), SIGTERM, then SIGKILL after graceMs. */
export async function stopSpawned(
  spawned: SpawnedSidecar,
  graceMs = 3000,
): Promise<void> {
  spawned.closeStdin()
  if (spawned.child.exitCode !== null || spawned.child.killed) return

  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      spawned.kill('SIGKILL')
      resolve()
    }, graceMs)
    spawned.child.once('exit', () => {
      clearTimeout(t)
      resolve()
    })
    spawned.kill('SIGTERM')
  })
}
