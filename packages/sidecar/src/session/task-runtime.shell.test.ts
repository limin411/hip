import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

  afterEach(async () => {
    // Awaited on purpose: a shell child still exiting holds a handle on `dir`,
    // and removing too early throws EBUSY on Windows. Retries absorb the
    // remaining exit race.
    await mgr.destroyAll()
    mgr.clear()
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
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

  // Regression: wait_any polls tasks that have a meta entry but no live promise
  // (schedule-only). Its exit condition used to depend solely on an exhausted
  // timeout budget, which is `undefined` when the caller omits timeout_ms — so
  // the poll spun at 50ms forever and a single agent tool call wedged the turn.
  it('wait_any returns promptly for a meta-only task even with no timeout', async () => {
    mgr.meta.set('sch-stuck', {
      description: 'never settling',
      status: 'running',
      kind: 'schedule',
      abortController: new AbortController(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const started = Date.now()
    const result = await mgr.waitMany(['sch-stuck'], 'wait_any')
    const elapsed = Date.now() - started
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].status).toBe('running')
    // Must terminate well before any plausible "waited forever" threshold.
    expect(elapsed).toBeLessThan(5_000)
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

  // GUARDRAIL: waitMany armed a setTimeout for the caller's timeout and never
  // cleared it on the winning path. Every wait left a live timer behind for up
  // to timeoutMs — busy event loop, delayed sidecar shutdown, and a growing
  // pile of handles for a long session that waits on tasks a lot.
  it.each(['wait_any', 'wait_all'] as const)('waitMany clears its timeout timer (%s)', async (mode) => {
    const setSpy = vi.spyOn(globalThis, 'setTimeout')
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    try {
      const started = mgr.spawnShell({ command: 'echo done', cwd: dir })
      expect('taskId' in started).toBe(true)
      if (!('taskId' in started)) return
      const result = await mgr.waitMany([started.taskId], mode, 60_000)
      expect(result.timed_out).toBe(false)

      // Scope the assertion to the handle this wait armed for its own timeout:
      // the manager (and vitest) legitimately own other timers.
      const armedIndex = setSpy.mock.calls.findIndex((c) => c[1] === 60_000)
      expect(armedIndex).toBeGreaterThanOrEqual(0)
      const handle = setSpy.mock.results[armedIndex]!.value as NodeJS.Timeout
      expect(clearSpy.mock.calls.some((c) => c[0] === handle)).toBe(true)
    } finally {
      setSpy.mockRestore()
      clearSpy.mockRestore()
    }
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
