import { describe, it, expect } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'

// Spawn the sidecar the way the Tauri shell does: `node --import tsx …/main.ts`
// with a PIPED stdin (tauri-plugin-shell pipes stdin and keeps the write end).
// Closing the child's stdin from here is exactly what the kernel does to the
// child when the Tauri parent process dies — by Cmd+Q, crash, or the E2E
// harness's SIGTERM/SIGKILL. So this faithfully reproduces the orphan scenario.
const ENTRY = resolve(process.cwd(), 'packages/sidecar/src/main.ts')

function spawnSidecar(extraEnv: Record<string, string>): ChildProcess {
  return spawn('node', ['--import', 'tsx', ENTRY], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HIP_DB_PATH: ':memory:', HIP_MODEL_DEEPSEEK_API_KEY: '', ...extraEnv },
  })
}

// Resolves once the sidecar prints its `{port,token}` line (fully started).
function waitForReady(child: ChildProcess): Promise<void> {
  return new Promise((res, rej) => {
    let buf = ''
    const timer = setTimeout(() => rej(new Error('sidecar never reported its port/token')), 20000)
    child.stdout!.on('data', (d: Buffer) => {
      buf += d.toString()
      if (/"port"\s*:\s*\d+/.test(buf)) {
        clearTimeout(timer)
        res()
      }
    })
    child.once('exit', () => {
      clearTimeout(timer)
      rej(new Error('sidecar exited before reporting ready'))
    })
  })
}

function onceExit(child: ChildProcess): Promise<number | null> {
  return new Promise((res) => child.once('exit', (code) => res(code)))
}

describe('sidecar parent-death watch (integration)', () => {
  it('exits when its stdin closes IF HIP_PARENT_WATCH is set (parent died)', async () => {
    const child = spawnSidecar({ HIP_PARENT_WATCH: '1' })
    try {
      await waitForReady(child)
      const exited = onceExit(child)
      // Simulate the parent dying: close the write end of the child's stdin.
      child.stdin!.end()
      const code = await Promise.race([
        exited,
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('sidecar did NOT exit after stdin closed')), 8000),
        ),
      ])
      expect(code).toBe(0)
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  }, 30000)

  it('keeps running when stdin closes if HIP_PARENT_WATCH is unset (standalone mode)', async () => {
    const child = spawnSidecar({}) // no watch flag → standalone dev/test behavior
    try {
      await waitForReady(child)
      let exitedEarly = false
      child.once('exit', () => {
        exitedEarly = true
      })
      child.stdin!.end()
      await new Promise((r) => setTimeout(r, 2000))
      expect(exitedEarly).toBe(false)
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  }, 30000)
})
