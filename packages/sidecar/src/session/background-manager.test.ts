import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BackgroundManager, BackgroundTaskPersistence } from './background-manager.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hip-bg-mgr-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeManager(
  sessionId = 'test-session',
  opts?: { maxTasks?: number; maxRetainedMeta?: number; persistence?: BackgroundTaskPersistence },
): BackgroundManager {
  return new BackgroundManager(sessionId, opts)
}

// ── Stop ──────────────────────────────────────────────────────────────────

describe('BackgroundManager.stop', () => {
  it('stop running background task → status becomes killed', () => {
    const mgr = makeManager()

    let aborted = false
    const result = mgr.spawn('task-1', 'test task', async (signal) => {
      signal.addEventListener('abort', () => { aborted = true })
      await new Promise<void>((resolve) => {
        // never resolves — task stays running until stopped
      })
    })
    expect(result).toBe('task-1')

    const stopResult = mgr.stop('task-1', 'no longer needed')
    expect(stopResult).toBe('killed')
    expect(aborted).toBe(true)

    const meta = mgr.meta.get('task-1')
    expect(meta).toBeTruthy()
    expect(meta!.status).toBe('killed')
    expect(meta!.error).toContain('killed by user: no longer needed')
  })

  it('stop non-existent task → returns error string', () => {
    const mgr = makeManager()
    const result = mgr.stop('nonexistent')
    expect(result).toBe('Error: background task nonexistent not found')
  })

  it('stop already completed task → returns error string', async () => {
    const mgr = makeManager()

    mgr.spawn('task-1', 'test', async () => {
      // completes immediately
    })

    // Wait for the task promise to settle
    await mgr.tasks.get('task-1')
    // Mark it as completed (simulating what runBackgroundSubagent does)
    mgr.completeTask('task-1', 'completed', 'done')

    const result = mgr.stop('task-1')
    expect(result).toBe('Error: background task task-1 is already completed')
  })

  it('stop a lost task → returns error string', () => {
    const mgr = makeManager()

    // Manually add a lost task (simulating reconcile aftermath)
    const ac = new AbortController()
    mgr.meta.set('orphan-1', {
      description: 'orphaned task',
      status: 'lost',
      error: 'process terminated while task was running',
      abortController: ac,
    })

    const result = mgr.stop('orphan-1')
    expect(result).toBe('Error: background task orphan-1 is already lost')
  })
})

// ── Wait ──────────────────────────────────────────────────────────────────

describe('BackgroundManager.wait', () => {
  it('wait for completed task → returns result within timeout', async () => {
    const mgr = makeManager()

    mgr.spawn('task-1', 'test', async () => {
      // completes with result
    })
    mgr.completeTask('task-1', 'completed', 'task output here')

    const result = await mgr.wait('task-1', 5000)
    expect(result).toBe('task output here')
  })

  it('wait for non-existent task → returns error string', async () => {
    const mgr = makeManager()
    const result = await mgr.wait('nonexistent')
    expect(result).toBe('Error: background task nonexistent not found')
  })

  it('wait with timeout → returns timeout error when task exceeds deadline', async () => {
    const mgr = makeManager()

    mgr.spawn('task-1', 'slow task', async () => {
      await new Promise((resolve) => setTimeout(resolve, 500))
    })

    const result = await mgr.wait('task-1', 10)
    expect(result).toContain('timeout')
  })

  it('wait for killed task → returns error describing kill', async () => {
    const mgr = makeManager()

    mgr.spawn('task-1', 'test', async () => {
      // never resolves
      await new Promise(() => {})
    })
    mgr.stop('task-1', 'user cancelled')

    const result = await mgr.wait('task-1')
    expect(result).toContain('killed')
  })

  it('wait for lost task → returns error containing lost', async () => {
    const mgr = makeManager()

    // Manually add a lost task (simulating reconcile aftermath)
    const ac = new AbortController()
    mgr.meta.set('orphan-1', {
      description: 'orphaned task',
      status: 'lost',
      error: 'process terminated while task was running',
      abortController: ac,
    })

    const result = await mgr.wait('orphan-1')
    expect(result).toContain('lost')
  })
})

// ── Spawn ─────────────────────────────────────────────────────────────────

describe('BackgroundManager.spawn', () => {
  it('spawn returns error when task is duplicate', () => {
    const mgr = makeManager()

    mgr.spawn('task-1', 'test', async () => {
      await new Promise(() => {})
    })

    const result = mgr.spawn('task-1', 'test', async () => {
      await new Promise(() => {})
    })
    expect(result).toContain('already running')
  })

  it('spawn returns error when max concurrency is exceeded', () => {
    const mgr = makeManager('s', { maxTasks: 2 })

    mgr.spawn('t1', 'test', async () => { await new Promise(() => {}) })
    mgr.spawn('t2', 'test', async () => { await new Promise(() => {}) })

    const result = mgr.spawn('t3', 'test', async () => {})
    expect(result).toContain('maximum 2')
  })

  it('spawned task cleanup — tasks removed after completion', async () => {
    const mgr = makeManager()

    mgr.spawn('task-1', 'test', async () => {
      // immediate completion
    })

    // Wait for the task promise to settle
    try {
      await mgr.wait('task-1', 1000)
    } catch {
      // expected if meta not yet updated
    }

    // The task map entry should have been removed by .finally()
    expect(mgr.tasks.has('task-1')).toBe(false)
  })
})

// ── Output ────────────────────────────────────────────────────────────────

describe('BackgroundManager output', () => {
  it('getOutput returns collected chunks', () => {
    const mgr = makeManager()

    mgr.spawn('task-1', 'test', async () => {
      // running
      await new Promise(() => {})
    })

    mgr.appendOutput('task-1', 'hello ')
    mgr.appendOutput('task-1', 'world')

    const output = mgr.getOutput('task-1')
    expect(output).toBe('hello world')
  })

  it('getOutput for non-existent task → returns error string', () => {
    const mgr = makeManager()
    const output = mgr.getOutput('nonexistent')
    expect(output).toBe('Error: background task nonexistent not found')
  })

  it('getOutput returns empty error when no output yet', () => {
    const mgr = makeManager()

    mgr.spawn('task-1', 'test', async () => {
      await new Promise(() => {})
    })

    const output = mgr.getOutput('task-1')
    expect(output).toContain('no output')
  })
})

// ── Persistence ───────────────────────────────────────────────────────────

describe('BackgroundTaskPersistence', () => {
  it('saveOutput appends chunks to output.log', () => {
    const persistence = new BackgroundTaskPersistence(tmpDir)
    persistence.saveOutput('s1', 'task-1', 'chunk1')
    persistence.saveOutput('s1', 'task-1', 'chunk2')

    const output = persistence.readOutput('s1', 'task-1')
    expect(output).toBe('chunk1chunk2')
  })

  it('readOutput returns null for non-existent task', () => {
    const persistence = new BackgroundTaskPersistence(tmpDir)
    const output = persistence.readOutput('s1', 'nonexistent')
    expect(output).toBeNull()
  })

  it('flushMeta writes meta.json', () => {
    const persistence = new BackgroundTaskPersistence(tmpDir)
    persistence.flushMeta('s1', 'task-1', { status: 'completed', result: 'done' })

    const meta = persistence.readMeta('s1', 'task-1')
    expect(meta).toBeTruthy()
    expect(meta!.status).toBe('completed')
    expect(meta!.result).toBe('done')
  })

  it('readMeta returns null for non-existent task', () => {
    const persistence = new BackgroundTaskPersistence(tmpDir)
    const meta = persistence.readMeta('s1', 'nonexistent')
    expect(meta).toBeNull()
  })

  it('listTaskIds returns all task directories', () => {
    const persistence = new BackgroundTaskPersistence(tmpDir)
    persistence.saveOutput('s1', 'task-1', 'chunk')
    persistence.saveOutput('s1', 'task-2', 'chunk')

    const ids = persistence.listTaskIds('s1')
    expect(ids).toContain('task-1')
    expect(ids).toContain('task-2')
  })

  it('listTaskIds returns empty array for non-existent session', () => {
    const persistence = new BackgroundTaskPersistence(tmpDir)
    const ids = persistence.listTaskIds('nonexistent-session')
    expect(ids).toEqual([])
  })
})

// ── Persistence integration with manager ──────────────────────────────────

describe('BackgroundManager with persistence', () => {
  it('appends output to persistence when configured', () => {
    const persistence = new BackgroundTaskPersistence(tmpDir)
    const mgr = makeManager('s1', { persistence })

    mgr.spawn('task-1', 'test', async () => {
      await new Promise(() => {})
    })

    mgr.appendOutput('task-1', 'partial result')

    const persisted = persistence.readOutput('s1', 'task-1')
    expect(persisted).toBe('partial result')
  })

  it('completeTask flushes meta to persistence', () => {
    const persistence = new BackgroundTaskPersistence(tmpDir)
    const mgr = makeManager('s1', { persistence })

    mgr.spawn('task-1', 'test', async () => {
      await new Promise(() => {})
    })
    mgr.completeTask('task-1', 'completed', 'final result')

    const meta = persistence.readMeta('s1', 'task-1')
    expect(meta).toBeTruthy()
    expect(meta!.status).toBe('completed')
    expect(meta!.result).toBe('final result')
  })

  it('stop flushes killed meta to persistence', () => {
    const persistence = new BackgroundTaskPersistence(tmpDir)
    const mgr = makeManager('s1', { persistence })

    mgr.spawn('task-1', 'test', async () => {
      await new Promise(() => {})
    })
    mgr.stop('task-1', 'timeout')

    const meta = persistence.readMeta('s1', 'task-1')
    expect(meta).toBeTruthy()
    expect(meta!.status).toBe('killed')
    expect(meta!.error).toContain('timeout')
  })

  it('reconcile marks running persisted tasks as lost', () => {
    const persistence = new BackgroundTaskPersistence(tmpDir)
    // Simulate a persisted task that was running when process died
    persistence.saveOutput('s1', 'orphan-1', 'partial work...')
    persistence.flushMeta('s1', 'orphan-1', { status: 'running' })

    const mgr = makeManager('s1', { persistence })
    const lost = mgr.reconcile()

    expect(lost).toContain('orphan-1')

    const meta = mgr.meta.get('orphan-1')
    expect(meta).toBeTruthy()
    expect(meta!.status).toBe('lost')
    expect(meta!.error).toContain('process terminated')
  })

  it('reconcile does not mark completed persisted tasks as lost', () => {
    const persistence = new BackgroundTaskPersistence(tmpDir)
    persistence.saveOutput('s1', 'finished-1', 'done')
    persistence.flushMeta('s1', 'finished-1', { status: 'completed', result: 'done' })

    const mgr = makeManager('s1', { persistence })
    const lost = mgr.reconcile()

    expect(lost).not.toContain('finished-1')
  })

  it('getOutput falls back to persisted output when in-memory is empty', () => {
    const persistence = new BackgroundTaskPersistence(tmpDir)
    persistence.saveOutput('s1', 'persisted-task', 'persisted content')
    persistence.flushMeta('s1', 'persisted-task', { status: 'completed', result: 'persisted content' })

    const mgr = makeManager('s1', { persistence })
    // Manually add meta without in-memory output
    const ac = new AbortController()
    mgr.meta.set('persisted-task', {
      description: 'persisted',
      status: 'completed',
      result: 'persisted content',
      abortController: ac,
    })

    const output = mgr.getOutput('persisted-task')
    // Should return persisted output since in-memory outputChunks is empty
    expect(output).toBe('persisted content')
  })
})

// ── List methods ──────────────────────────────────────────────────────────

describe('BackgroundManager list methods', () => {
  it('runningEntries returns running tasks only', () => {
    const mgr = makeManager()

    mgr.spawn('t1', 'running task', async () => { await new Promise(() => {}) })
    mgr.spawn('t2', 'completed task', async () => {})
    mgr.completeTask('t2', 'completed', 'done')

    const running = mgr.runningEntries()
    expect(running).toHaveLength(1)
    expect(running[0].id).toBe('t1')
    expect(running[0].status).toBe('running')
  })

  it('completedEntries returns terminal tasks only', () => {
    const mgr = makeManager()

    mgr.spawn('t1', 'running task', async () => { await new Promise(() => {}) })
    mgr.spawn('t2', 'completed task', async () => {})
    mgr.completeTask('t2', 'completed', 'done')
    mgr.spawn('t3', 'failed task', async () => { throw new Error('boom') })
    mgr.completeTask('t3', 'failed', undefined, 'boom')

    const completed = mgr.completedEntries()
    expect(completed).toHaveLength(2)
    const ids = completed.map((e) => e.id)
    expect(ids).toContain('t2')
    expect(ids).toContain('t3')
  })
})
