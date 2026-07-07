import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { LoopManager, HEARTBEAT_LOOPS_DDL } from './index.js'
import type { HeartbeatConfig, TickHandler } from './heartbeat-loop.js'

// Use dynamic import for the native SQLite module
async function createMemoryDb(): Promise<import('../../persistence/sqlite.js').DatabaseSync> {
  const { DatabaseSync } = await import('../../persistence/sqlite.js')
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(HEARTBEAT_LOOPS_DDL)
  return db
}

describe('LoopManager', () => {
  let tickHandler: ReturnType<typeof vi.fn>

  beforeEach(() => {
    tickHandler = vi.fn().mockResolvedValue('ok')
  })

  describe('without persistence', () => {
    let manager: LoopManager

    beforeEach(() => {
      manager = new LoopManager(null, tickHandler)
    })

    afterEach(() => {
      manager?.stopAll()
    })

    it('register creates a loop and returns its id', () => {
      const id = manager.register({
        id: 'loop-1',
        intervalMs: 10000,
        agentId: 'agent-1',
        prompt: 'do work',
      })
      expect(id).toBe('loop-1')
      expect(manager.size).toBe(1)
    })

    it('unregister removes a loop and returns true', () => {
      manager.register({
        id: 'loop-1',
        intervalMs: 10000,
        agentId: 'agent-1',
        prompt: 'do work',
      })
      expect(manager.unregister('loop-1')).toBe(true)
      expect(manager.size).toBe(0)
    })

    it('unregister returns false for unknown loop', () => {
      expect(manager.unregister('nonexistent')).toBe(false)
    })

    it('register replaces an existing loop with the same id', () => {
      manager.register({
        id: 'loop-1',
        intervalMs: 10000,
        agentId: 'agent-1',
        prompt: 'first',
      })
      manager.register({
        id: 'loop-1',
        intervalMs: 20000,
        agentId: 'agent-2',
        prompt: 'second',
      })
      expect(manager.size).toBe(1)
      const loop = manager.get('loop-1')
      expect(loop?.config.agentId).toBe('agent-2')
      expect(loop?.config.prompt).toBe('second')
    })

    it('get returns the loop or undefined', () => {
      const id = manager.register({
        id: 'loop-1',
        intervalMs: 10000,
        agentId: 'a1',
        prompt: 'hi',
      })
      expect(manager.get(id)).toBeDefined()
      expect(manager.get('nonexistent')).toBeUndefined()
    })

    it('listStatuses returns all loop statuses', () => {
      manager.register({ id: 'l1', intervalMs: 10000, agentId: 'a1', prompt: 'p1' })
      manager.register({ id: 'l2', intervalMs: 20000, agentId: 'a2', prompt: 'p2' })
      const statuses = manager.listStatuses()
      expect(statuses).toHaveLength(2)
      const ids = statuses.map((s) => s.id).sort()
      expect(ids).toEqual(['l1', 'l2'])
    })

    it('startAll starts all loops', () => {
      vi.useFakeTimers()
      try {
        manager.register({ id: 'l1', intervalMs: 1000, agentId: 'a1', prompt: 'p1' })
        manager.register({ id: 'l2', intervalMs: 1000, agentId: 'a2', prompt: 'p2' })

        manager.startAll()

        const statuses = manager.listStatuses()
        expect(statuses.every((s) => s.status === 'running')).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('stopAll stops all loops', () => {
      vi.useFakeTimers()
      try {
        manager.register({ id: 'l1', intervalMs: 1000, agentId: 'a1', prompt: 'p1' })
        manager.startAll()
        manager.stopAll()

        const statuses = manager.listStatuses()
        expect(statuses.every((s) => s.status === 'stopped')).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('with SQLite persistence', () => {
    let db: import('../../persistence/sqlite.js').DatabaseSync
    let manager: LoopManager

    beforeEach(async () => {
      db = await createMemoryDb()
      tickHandler = vi.fn().mockResolvedValue('persisted output')
      manager = new LoopManager(db, tickHandler)
    })

    afterEach(() => {
      // Stop all loops BEFORE closing the database
      manager?.stopAll()
      db?.close()
    })

    it('persists loop state after registration', () => {
      manager.register({
        id: 'persist-loop',
        intervalMs: 10000,
        agentId: 'agent-x',
        prompt: 'persist me',
        maxRuns: 5,
      })

      const row = db.prepare('SELECT * FROM heartbeat_loops WHERE id = ?').get('persist-loop') as Record<string, unknown>
      expect(row).toBeDefined()
      expect(row.agent_id).toBe('agent-x')
      expect(row.prompt).toBe('persist me')
      expect(row.interval_ms).toBe(10000)
      expect(row.max_runs).toBe(5)
      expect(row.status).toBe('idle')
      expect(row.run_count).toBe(0)
    })

    it('persists state changes after tick', async () => {
      vi.useFakeTimers()
      try {
        manager.register({
          id: 'tick-persist',
          intervalMs: 1000,
          agentId: 'a1',
          prompt: 'tick',
        })

        const loop = manager.get('tick-persist')!
        loop.start()

        await vi.advanceTimersByTimeAsync(1000)

        const row = db.prepare('SELECT * FROM heartbeat_loops WHERE id = ?').get('tick-persist') as Record<string, unknown>
        expect(row.run_count).toBe(1)
        expect(row.last_output).toBe('persisted output')
        expect(row.last_run_at).toBeGreaterThan(0)
        expect(row.status).toBe('running')
      } finally {
        vi.useRealTimers()
      }
    })

    it('deletes row on unregister', () => {
      manager.register({
        id: 'delete-me',
        intervalMs: 10000,
        agentId: 'a1',
        prompt: 'delete',
      })
      expect(manager.size).toBe(1)

      manager.unregister('delete-me')
      expect(manager.size).toBe(0)

      const row = db.prepare('SELECT * FROM heartbeat_loops WHERE id = ?').get('delete-me')
      expect(row).toBeUndefined()
    })

    it('restores loops from persistence', () => {
      // Insert a row directly into the database
      const now = Date.now()
      db.prepare(
        `INSERT INTO heartbeat_loops (id, agent_id, prompt, interval_ms, max_runs, status, run_count, last_run_at, last_output, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('restored-loop', 'agent-r', 'restored prompt', 5000, null, 'idle', 3, now, 'prev output', now, now)

      // Create a new manager — it should restore the loop
      const manager2 = new LoopManager(db, tickHandler)
      expect(manager2.size).toBe(1)

      const loop = manager2.get('restored-loop')
      expect(loop).toBeDefined()
      const s = loop!.status()
      expect(s.config.agentId).toBe('agent-r')
      expect(s.config.prompt).toBe('restored prompt')
      expect(s.config.intervalMs).toBe(5000)
      expect(s.runCount).toBe(3)
      expect(s.lastOutput).toBe('prev output')
      expect(s.status).toBe('idle') // Always restored as idle
    })

    it('restored loops can be started', async () => {
      vi.useFakeTimers()
      try {
        const now = Date.now()
        db.prepare(
          `INSERT INTO heartbeat_loops (id, agent_id, prompt, interval_ms, max_runs, status, run_count, last_run_at, last_output, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run('restored-start', 'agent-s', 'start me', 1000, 2, 'running', 0, null, null, now, now)

        const manager2 = new LoopManager(db, tickHandler)
        manager2.startAll()

        await vi.advanceTimersByTimeAsync(2500)

        // Should have ticked 2 times (up to maxRuns=2)
        expect(tickHandler).toHaveBeenCalledTimes(2)

        const s = manager2.get('restored-start')!.status()
        expect(s.runCount).toBe(2)
        expect(s.status).toBe('stopped') // auto-stopped after maxRuns
      } finally {
        vi.useRealTimers()
      }
    })

    it('persistence round-trip with maxRuns', async () => {
      vi.useFakeTimers()
      try {
        manager.register({
          id: 'maxrun-test',
          intervalMs: 1000,
          agentId: 'a1',
          prompt: 'run',
          maxRuns: 3,
        })

        const loop = manager.get('maxrun-test')!
        loop.start()

        await vi.advanceTimersByTimeAsync(4000)

        // Should have auto-stopped after 3 runs
        const s = loop.status()
        expect(s.runCount).toBe(3)
        expect(s.status).toBe('stopped')

        // Verify DB state
        const row = db.prepare('SELECT * FROM heartbeat_loops WHERE id = ?').get('maxrun-test') as Record<string, unknown>
        expect(row.run_count).toBe(3)
        expect(row.status).toBe('stopped')
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
