/**
 * Shell process spawn/kill helpers (Windows-first kill ladder).
 * Spec: docs/design/2026-07-22-async-task-runtime-right-panel.md § Shell backend
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface SpawnShellOptions {
  command: string
  cwd: string
  env?: NodeJS.ProcessEnv
  /** AbortSignal cancels the process when aborted. */
  signal?: AbortSignal
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

export interface SpawnedShell {
  pid: number | null
  child: ChildProcess
  /** Kill process tree (best-effort). */
  kill: () => Promise<void>
  /** Promise settles when process exits. */
  done: Promise<{ exitCode: number | null; timedOut: boolean; signal?: string }>
  markTimedOut: () => void
}

function isWin(): boolean {
  return process.platform === 'win32'
}

/** Kill a process tree: POSIX process group, Windows taskkill /T ladder. */
export async function killProcessTree(pid: number | null | undefined, child?: ChildProcess): Promise<void> {
  if (pid == null && !child) return
  if (isWin()) {
    const target = pid ?? child?.pid
    if (target == null) {
      try { child?.kill() } catch { /* gone */ }
      return
    }
    try {
      await execFileAsync('taskkill', ['/PID', String(target), '/T', '/F'], {
        windowsHide: true,
        timeout: 5_000,
      })
    } catch {
      try { child?.kill() } catch { /* gone */ }
    }
    return
  }
  if (pid != null) {
    try {
      process.kill(-pid, 'SIGKILL')
      return
    } catch {
      /* fall through */
    }
  }
  try { child?.kill('SIGKILL') } catch { /* gone */ }
}

/**
 * Spawn a shell command. Non-Windows: detached process group for group kill.
 * Windows: cmd /c (v1 default per KD-26).
 */
export function spawnShell(opts: SpawnShellOptions): SpawnedShell {
  const win = isWin()
  const shell = win ? 'cmd' : 'sh'
  const shellArgs = win ? ['/c', opts.command] : ['-c', opts.command]
  const child = spawn(shell, shellArgs, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    detached: !win,
    windowsHide: true,
  })

  let timedOut = false
  let settled = false
  let resolveDone!: (v: { exitCode: number | null; timedOut: boolean; signal?: string }) => void
  const done = new Promise<{ exitCode: number | null; timedOut: boolean; signal?: string }>((resolve) => {
    resolveDone = resolve
  })

  const finish = (exitCode: number | null, signal?: string) => {
    if (settled) return
    settled = true
    resolveDone({ exitCode, timedOut, signal })
  }

  child.stdout?.on('data', (b: Buffer) => opts.onStdout?.(b.toString('utf8')))
  child.stderr?.on('data', (b: Buffer) => opts.onStderr?.(b.toString('utf8')))
  child.on('error', () => finish(null))
  child.on('close', (code, signal) => finish(code, signal ?? undefined))

  const kill = async () => {
    await killProcessTree(child.pid, child)
  }

  if (opts.signal) {
    const onAbort = () => {
      void kill()
    }
    if (opts.signal.aborted) onAbort()
    else opts.signal.addEventListener('abort', onAbort, { once: true })
  }

  return {
    pid: child.pid ?? null,
    child,
    kill,
    done,
    markTimedOut: () => {
      timedOut = true
    },
  }
}

/** Run shell to completion with optional timeoutMs (defaults handled by caller). */
export async function runShellForeground(opts: SpawnShellOptions & {
  timeoutMs: number
  outputCap: number
}): Promise<{ exitCode: number | null; output: string; timedOut: boolean; truncated: boolean }> {
  let out = ''
  let capped = false
  const onChunk = (chunk: string) => {
    if (capped) return
    out += chunk
    if (out.length > opts.outputCap) {
      out = out.slice(0, opts.outputCap)
      capped = true
    }
  }
  const shell = spawnShell({
    ...opts,
    onStdout: onChunk,
    onStderr: onChunk,
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  if (opts.timeoutMs > 0) {
    timer = setTimeout(() => {
      shell.markTimedOut()
      void shell.kill()
    }, opts.timeoutMs)
    timer.unref?.()
  }

  const result = await shell.done
  if (timer) clearTimeout(timer)
  return {
    exitCode: result.exitCode,
    output: out,
    timedOut: result.timedOut,
    truncated: capped,
  }
}
