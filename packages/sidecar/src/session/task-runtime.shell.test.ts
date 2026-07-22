import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BackgroundManager } from './background-manager.js'

describe('TaskRuntime shell / wait / caps', () => {
  let dir: string
  let mgr: BackgroundManager

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hip-task-rt-'))
    mgr = new BackgroundManager('sess-shell', {
      caps: { agent: 2, shell: 3, monitor: 2, schedule: 5, globalRunning: 10 },
    })
  })

  afterEach(() => {
    void mgr.destroyAll()
    mgr.clear()
    rmSync(dir, { recursive: true, force: true })
  })

  it('spawns background shell and captures output', async () => {
    const script = join(dir, 'hi.sh')
    writeFileSync(script, '#!/bin/sh\necho hello-bg\n', { mode: 0o755 })
    const started = mgr.spawnShell({
      command: process.platform === 'win32' ? `echo hello-bg` : `sh ${script}`,
      cwd: dir,
      description: 'echo',
    })
    expect('taskId' in started).toBe(true)
    if (!('taskId' in started)) return
    const out = await mgr.wait(started.taskId, 10_000)
    expect(out).toMatch(/hello-bg/)
    const snap = mgr.listSnapshot().find((t) => t.id === started.taskId)
    expect(snap?.kind).toBe('shell')
    expect(snap?.status).toBe('completed')
  })

  it('enforces per-kind shell cap independently of agent cap', () => {
    // fill agent slots
    for (let i = 0; i < 2; i++) {
      const id = mgr.spawn(`worker-${i}`, `a${i}`, async () => {
        await new Promise((r) => setTimeout(r, 30_000))
      })
      expect(id).toBe(`worker-${i}`)
    }
    // shell should still spawn
    const s = mgr.spawnShell({ command: process.platform === 'win32' ? 'echo x' : 'echo x', cwd: dir })
    expect('taskId' in s).toBe(true)
  })

  it('waitMany wait_all returns structured payloads', async () => {
    const a = mgr.spawnShell({
      command: process.platform === 'win32' ? 'echo a' : 'echo a',
      cwd: dir,
    })
    const b = mgr.spawnShell({
      command: process.platform === 'win32' ? 'echo b' : 'echo b',
      cwd: dir,
    })
    expect('taskId' in a && 'taskId' in b).toBe(true)
    if (!('taskId' in a) || !('taskId' in b)) return
    const result = await mgr.waitMany([a.taskId, b.taskId], 'wait_all', 10_000)
    expect(result.timed_out).toBe(false)
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks.every((t) => t.kind === 'shell')).toBe(true)
  })

  it('destroyAll kills running shells', async () => {
    const started = mgr.spawnShell({
      command: process.platform === 'win32' ? 'ping -n 30 127.0.0.1' : 'sleep 30',
      cwd: dir,
      description: 'long',
    })
    expect('taskId' in started).toBe(true)
    await mgr.destroyAll()
    const m = [...mgr.meta.values()].find((x) => x.kind === 'shell')
    expect(m?.status === 'killed' || m == null || !mgr.tasks.has((started as { taskId: string }).taskId)).toBe(
      true,
    )
  })
})
