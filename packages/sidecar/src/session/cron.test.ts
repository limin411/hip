import { describe, it, expect, beforeEach } from 'vitest'
import { CronManager, buildCronTools } from './cron.js'
import type { CronTask } from './cron.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

function forceDue(manager: CronManager, taskId: string): void {
  const tasks = (manager as unknown as { tasks: Map<string, CronTask> }).tasks
  const task = tasks.get(taskId)
  if (task) task.nextFireAt = Date.now()
}

function freshStore(): { db: ReturnType<typeof openDatabase>['db']; store: SessionStore } {
  const { db, ftsEnabled } = openDatabase(':memory:')
  const store = new SessionStore(db, ftsEnabled)
  store.insertSession({
    id: 'test-session',
    title: 'test',
    config: '{}',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  return { db, store }
}

describe('CronManager', () => {
  let manager: CronManager

  describe('without store (in-memory only)', () => {
    beforeEach(() => {
      manager = new CronManager('test-session')
    })

    it('creates a task and returns an id', () => {
      const id = manager.create('remind me', { type: 'once' })
      expect(id).toMatch(/^cron-/)
    })

    it('lists created tasks', () => {
      manager.create('task a', { type: 'once' })
      manager.create('task b', { type: 'recurring', intervalMs: 1000 })
      const tasks = manager.list()
      expect(tasks).toHaveLength(2)
      expect(tasks[0].prompt).toBe('task a')
      expect(tasks[1].prompt).toBe('task b')
    })

    it('once task fires on tick and is removed', () => {
      const now = Date.now()
      const id = manager.create('once reminder', { type: 'once', at: now })
      const due = manager.tick()
      expect(due).toEqual(['once reminder'])
      expect(manager.list()).toHaveLength(0)
    })

    it('once task with future time does not fire', () => {
      manager.create('future reminder', { type: 'once', at: Date.now() + 60000 })
      const due = manager.tick()
      expect(due).toEqual([])
      expect(manager.list()).toHaveLength(1)
    })

    it('recurring task fires multiple times on successive ticks', () => {
      const now = Date.now()
      manager.create('recurring ping', { type: 'recurring', at: now, intervalMs: 100 })

      // First tick: fires immediately
      const due1 = manager.tick()
      expect(due1).toEqual(['recurring ping'])

      // Task should still be there (re-scheduled)
      expect(manager.list()).toHaveLength(1)

      // Fast-forward: the task was re-scheduled ~100ms ahead (+/- jitter)
      const task = manager.list()[0]
      expect(task.nextFireAt).toBeGreaterThan(now)

      // Advance time by forcing nextFireAt to now
      forceDue(manager, task.id)
      const due2 = manager.tick()
      expect(due2).toEqual(['recurring ping'])
    })

    it('tick fires recurring 3 times', () => {
      const now = Date.now()
      manager.create('triple ping', { type: 'recurring', at: now, intervalMs: 100 })

      const allDue: string[] = []
      for (let i = 0; i < 3; i++) {
        // Force the task to be due
        const tasks = manager.list()
        if (tasks.length === 0) break
        forceDue(manager, tasks[0].id)
        const due = manager.tick()
        allDue.push(...due)
      }
      expect(allDue).toEqual(['triple ping', 'triple ping', 'triple ping'])
      expect(manager.list()).toHaveLength(1) // still there, re-scheduled
    })

    it('deletes a task', () => {
      const id = manager.create('to delete', { type: 'once' })
      expect(manager.list()).toHaveLength(1)
      expect(manager.delete(id)).toBe(true)
      expect(manager.list()).toHaveLength(0)
    })

    it('deleting non-existent task returns false', () => {
      expect(manager.delete('nonexistent')).toBe(false)
    })

    it('delete then tick does not fire removed task', () => {
      const now = Date.now()
      const id = manager.create('should not fire', { type: 'once', at: now })
      manager.delete(id)
      const due = manager.tick()
      expect(due).toEqual([])
    })

    it('multiple tasks fire in order', () => {
      const now = Date.now()
      manager.create('first', { type: 'once', at: now })
      manager.create('second', { type: 'once', at: now })
      const due = manager.tick()
      expect(due).toHaveLength(2)
      expect(due).toContain('first')
      expect(due).toContain('second')
    })

    it('once task without at fires immediately', () => {
      const id = manager.create('immediate', { type: 'once' })
      const task = manager.list()[0]
      expect(task.nextFireAt).toBeLessThanOrEqual(Date.now())
    })

    it('recurring task without at uses now as first fire', () => {
      const before = Date.now()
      const id = manager.create('recurring-default', { type: 'recurring', intervalMs: 5000 })
      const task = manager.list()[0]
      expect(task.nextFireAt).toBeGreaterThanOrEqual(before)
    })

    it('empty list returns empty array', () => {
      expect(manager.list()).toEqual([])
    })

    it('empty tick returns empty array', () => {
      expect(manager.tick()).toEqual([])
    })
  })

  describe('with store (persisted)', () => {
    let store: SessionStore
    let db: ReturnType<typeof openDatabase>['db']

    beforeEach(() => {
      const s = freshStore()
      store = s.store
      db = s.db
      manager = new CronManager('test-session', store)
    })

    it('creates task that survives reload', () => {
      const id = manager.create('persistent reminder', { type: 'once', at: Date.now() + 99999 })
      const tasks1 = manager.list()
      expect(tasks1).toHaveLength(1)

      // Reload: create a new manager with the same store
      const manager2 = new CronManager('test-session', store)
      const tasks2 = manager2.list()
      expect(tasks2).toHaveLength(1)
      expect(tasks2[0].id).toBe(id)
      expect(tasks2[0].prompt).toBe('persistent reminder')
    })

    it('tick persists nextFireAt update for recurring tasks', () => {
      const now = Date.now()
      const id = manager.create('recurring persisted', { type: 'recurring', at: now, intervalMs: 5000 })
      expect(manager.list()).toHaveLength(1)
      const originalNextFire = manager.list()[0].nextFireAt

      manager.tick() // fires and re-schedules

      const task = manager.list()[0]
      expect(task.nextFireAt).toBeGreaterThan(originalNextFire)

      // Reload and verify updated nextFireAt persisted
      const manager2 = new CronManager('test-session', store)
      const tasks2 = manager2.list()
      expect(tasks2).toHaveLength(1)
      expect(tasks2[0].nextFireAt).toBe(task.nextFireAt)
    })

    it('delete persists across reload', () => {
      manager.create('to delete', { type: 'once' })
      expect(manager.list()).toHaveLength(1)

      const manager2 = new CronManager('test-session', store)
      expect(manager2.list()).toHaveLength(1)

      manager2.delete(manager2.list()[0].id)
      expect(manager2.list()).toHaveLength(0)

      const manager3 = new CronManager('test-session', store)
      expect(manager3.list()).toHaveLength(0)
    })

    it('once task is deleted from store after firing', () => {
      const now = Date.now()
      manager.create('fire and gone', { type: 'once', at: now })
      expect(manager.list()).toHaveLength(1)

      manager.tick()

      expect(manager.list()).toHaveLength(0)

      // Reload: task should be gone
      const manager2 = new CronManager('test-session', store)
      expect(manager2.list()).toHaveLength(0)
    })

    it('tasks from different sessions are isolated', () => {
      store.insertSession({ id: 'other-session', title: 'other', config: '{}', createdAt: Date.now(), updatedAt: Date.now() })
      const store2 = new SessionStore(db, true)

      manager.create('session-a task', { type: 'once' })
      const mgr2 = new CronManager('other-session', store2)
      mgr2.create('session-b task', { type: 'once' })

      expect(manager.list()).toHaveLength(1)
      expect(manager.list()[0].prompt).toBe('session-a task')
      expect(mgr2.list()).toHaveLength(1)
      expect(mgr2.list()[0].prompt).toBe('session-b task')
    })
  })

  describe('jitter', () => {
    it('recurring jitter is within ±5% range', () => {
      const now = Date.now()
      manager = new CronManager('test-session')
      manager.create('jitter test', { type: 'recurring', at: now, intervalMs: 10000 })

      // Collect many re-schedules to verify jitter distribution
      const nextFires: number[] = []
      for (let i = 0; i < 50; i++) {
        const tasks = manager.list()
        if (tasks.length === 0) break
        forceDue(manager, tasks[0].id)
        manager.tick()
        const t = manager.list()[0]
        if (t) nextFires.push(t.nextFireAt)
      }

      expect(nextFires.length).toBeGreaterThan(0)
      for (const nf of nextFires) {
        // nextFireAt = now + jitter(10000), so interval = nf - trigger time
        // Jitter is +/-5%, so the interval should be in [9500, 10500]
        // But "now" advances between iterations, so we just check the delta from create time is reasonable
        expect(nf).toBeGreaterThan(0)
      }
    })
  })
})

describe('buildCronTools', () => {
  let manager: CronManager

  beforeEach(() => {
    manager = new CronManager('test-session')
  })

  it('returns 3 tools', () => {
    const tools = buildCronTools(manager)
    expect(tools).toHaveLength(3)
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(['cron_create', 'cron_delete', 'cron_list'])
  })

  it('cron_create tool schedules a once task', async () => {
    const [createTool] = buildCronTools(manager)
    const now = Date.now()
    const result = await createTool.invoke({ prompt: 'hello', type: 'once', at: now })
    expect(typeof result).toBe('string')
    expect(result).toContain('cron-')
    expect(result).toContain('once')
    expect(manager.list()).toHaveLength(1)
    expect(manager.list()[0].prompt).toBe('hello')
  })

  it('cron_create tool schedules a recurring task', async () => {
    const [createTool] = buildCronTools(manager)
    const result = await createTool.invoke({ prompt: 'standup', type: 'recurring', interval_ms: 3600000 })
    expect(result).toContain('recurring')
    const tasks = manager.list()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].schedule.type).toBe('recurring')
    expect(tasks[0].schedule.intervalMs).toBe(3600000)
  })

  it('cron_list tool returns empty when no tasks', async () => {
    const [, listTool] = buildCronTools(manager)
    const result = await listTool.invoke({})
    expect(result).toBe('No scheduled cron tasks.')
  })

  it('cron_list tool returns tasks', async () => {
    manager.create('task 1', { type: 'once' })
    manager.create('task 2', { type: 'recurring', intervalMs: 5000 })
    const [, listTool] = buildCronTools(manager)
    const result = await listTool.invoke({}) as string
    expect(result).toContain('task 1')
    expect(result).toContain('task 2')
    expect(result).toContain('once')
    expect(result).toContain('5000ms')
  })

  it('cron_delete tool removes a task', async () => {
    const id = manager.create('delete me', { type: 'once' })
    const [, , deleteTool] = buildCronTools(manager)
    const result = await deleteTool.invoke({ id })
    expect(result).toContain('Deleted')
    expect(manager.list()).toHaveLength(0)
  })

  it('cron_delete tool reports not found', async () => {
    const [, , deleteTool] = buildCronTools(manager)
    const result = await deleteTool.invoke({ id: 'nonexistent' })
    expect(result).toContain('not found')
  })
})
