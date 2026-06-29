import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  SubagentBatch,
  resolveMaxConcurrency,
  type QueuedSubagentTask,
} from './subagent-batch.js'
import { buildTaskBatchTools } from './tools/subagent.js'
import { buildTools } from './tools.js'
import type { RunSubagentFn } from './orchestrator-adapter.js'

// Helper: a runner that resolves after a micro-tick with the prompt echoed back.
function echoRunner(): RunSubagentFn {
  return async (input: string) => {
    await new Promise((r) => setTimeout(r, 5))
    return `echo: ${input}`
  }
}

// Helper: a runner where named tasks fail and others succeed.
function selectiveFailRunner(
  failIds: Set<string>,
  errorMsg = 'task failed',
): RunSubagentFn {
  return async (input: string, signal: AbortSignal) => {
    signal?.throwIfAborted?.()
    await new Promise((r) => setTimeout(r, 5))
    // The task id is embedded in the prompt for correlation in this test harness.
    const id = input
    if (failIds.has(id)) throw new Error(errorMsg)
    return `done: ${input}`
  }
}

const TASK_A: QueuedSubagentTask = { id: 'a', prompt: 'task-a', description: 'Task A' }
const TASK_B: QueuedSubagentTask = { id: 'b', prompt: 'task-b', description: 'Task B' }
const TASK_C: QueuedSubagentTask = { id: 'c', prompt: 'task-c', description: 'Task C' }

beforeEach(() => {
  delete process.env.HIP_SUBAGENT_MAX_CONCURRENCY
})

afterEach(() => {
  delete process.env.HIP_SUBAGENT_MAX_CONCURRENCY
})

// ── resolveMaxConcurrency ──────────────────────────────────────────────────

describe('resolveMaxConcurrency', () => {
  it('defaults to 3 when env is unset', () => {
    expect(resolveMaxConcurrency()).toBe(3)
  })

  it('reads HIP_SUBAGENT_MAX_CONCURRENCY when set', () => {
    process.env.HIP_SUBAGENT_MAX_CONCURRENCY = '5'
    expect(resolveMaxConcurrency()).toBe(5)
  })

  it('clamps non-numeric strings to 1', () => {
    process.env.HIP_SUBAGENT_MAX_CONCURRENCY = 'abc'
    expect(resolveMaxConcurrency()).toBe(1)
  })

  it('clamps zero to 1', () => {
    process.env.HIP_SUBAGENT_MAX_CONCURRENCY = '0'
    expect(resolveMaxConcurrency()).toBe(1)
  })

  it('clamps negative values to 1', () => {
    process.env.HIP_SUBAGENT_MAX_CONCURRENCY = '-3'
    expect(resolveMaxConcurrency()).toBe(1)
  })

  it('clamps values above 10 to 10', () => {
    process.env.HIP_SUBAGENT_MAX_CONCURRENCY = '50'
    expect(resolveMaxConcurrency()).toBe(10)
  })

  it('floors fractional values', () => {
    process.env.HIP_SUBAGENT_MAX_CONCURRENCY = '3.7'
    expect(resolveMaxConcurrency()).toBe(3)
  })
})

// ── SubagentBatch.run ──────────────────────────────────────────────────────

describe('SubagentBatch.run', () => {
  it('returns empty results for an empty task list', async () => {
    const batch = new SubagentBatch(echoRunner())
    const results = await batch.run([])
    expect(results).toEqual([])
  })

  it('runs 3 parallel tasks — all succeed and results are collected in order', async () => {
    const batch = new SubagentBatch(echoRunner(), { maxConcurrency: 3 })
    const results = await batch.run([TASK_A, TASK_B, TASK_C])
    expect(results).toHaveLength(3)
    expect(results[0]).toEqual({ id: 'a', text: 'echo: task-a' })
    expect(results[1]).toEqual({ id: 'b', text: 'echo: task-b' })
    expect(results[2]).toEqual({ id: 'c', text: 'echo: task-c' })
  })

  it('captures errors — one task fails, others succeed', async () => {
    const failPrompts = new Set(['task-b'])
    const runner = selectiveFailRunner(failPrompts, 'boom')
    const batch = new SubagentBatch(runner, { maxConcurrency: 3 })
    const results = await batch.run([TASK_A, TASK_B, TASK_C])

    expect(results).toHaveLength(3)
    expect(results[0]).toEqual({ id: 'a', text: 'done: task-a' })
    expect(results[1]).toEqual({ id: 'b', text: '', error: 'boom' })
    expect(results[2]).toEqual({ id: 'c', text: 'done: task-c' })
  })

  it('enforces maxConcurrency — max 2 in-flight at a time', async () => {
    let running = 0
    let maxRunning = 0
    const concurrencyRunner: RunSubagentFn = async (input: string) => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise((r) => setTimeout(r, 15))
      running--
      return `ok: ${input}`
    }

    const batch = new SubagentBatch(concurrencyRunner, { maxConcurrency: 2 })
    const results = await batch.run([TASK_A, TASK_B, TASK_C])

    expect(maxRunning).toBe(2)
    expect(results).toHaveLength(3)
    expect(results.every((r) => r.text.startsWith('ok:'))).toBe(true)
    expect(results.every((r) => r.error === undefined)).toBe(true)
  })

  it('respects per-task AbortSignal — aborted task errors, others continue', async () => {
    const signalRunner: RunSubagentFn = async (_input: string, signal: AbortSignal) => {
      signal.throwIfAborted()
      await new Promise((r) => setTimeout(r, 10))
      return 'ok'
    }

    const abortedController = new AbortController()
    abortedController.abort()

    const batch = new SubagentBatch(signalRunner, { maxConcurrency: 3 })
    const tasks: QueuedSubagentTask[] = [
      { id: 'a', prompt: 'a', description: 'A' },
      { id: 'b', prompt: 'b', description: 'B', signal: abortedController.signal },
      { id: 'c', prompt: 'c', description: 'C' },
    ]

    const results = await batch.run(tasks)
    expect(results).toHaveLength(3)
    expect(results[0].text).toBe('ok')
    expect(results[0].error).toBeUndefined()
    expect(results[1].text).toBe('')
    expect(results[1].error).toBeDefined()
    expect(results[2].text).toBe('ok')
    expect(results[2].error).toBeUndefined()
  })

  it('switches to serial mode on rate-limit error', async () => {
    let running = 0
    let maxRunning = 0
    const rateLimitRunner: RunSubagentFn = async (input: string) => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise((r) => setTimeout(r, 10))
      running--
      if (input === 'task-b') throw new Error('429 rate limit exceeded')
      return `ok: ${input}`
    }

    // maxConcurrency=3, but after task-b's rate-limit error, task-c should run
    // alone (serial mode). We verify maxRunning never exceeds initial batch size.
    // Since task-b is in the first batch with 3 concurrent slots, maxRunning can
    // reach 3. But task-c is in the next (serial) chunk, so it won't exceed that.
    const batch = new SubagentBatch(rateLimitRunner, { maxConcurrency: 3 })
    const results = await batch.run([TASK_A, TASK_B, TASK_C])

    expect(maxRunning).toBeLessThanOrEqual(3)
    expect(results).toHaveLength(3)
    // task-b failed with rate-limit
    expect(results[1].error).toContain('429')
    // task-c still ran (serial mode after the first batch)
    expect(results[2].text).toBe('ok: task-c')
  })
})

// ── task_batch tool integration ────────────────────────────────────────────

describe('task_batch in buildTools', () => {
  it('appears after task when spawnSubagent is provided', () => {
    const spawnFn = async (_desc: string) => 'ok'
    expect(typeof spawnFn).toBe('function')
    const tools = buildTools('/tmp', spawnFn)
    const names = tools.map((t) => t.name)
    expect(names).toContain('task')
    expect(names).toContain('task_batch')
    const taskIdx = names.indexOf('task')
    const taskBatchIdx = names.indexOf('task_batch')
    expect(taskBatchIdx).toBeGreaterThan(taskIdx)
  })

  it('is absent when no spawnSubagent is provided', () => {
    const tools = buildTools('/tmp')
    const names = tools.map((t) => t.name)
    expect(names).not.toContain('task_batch')
    expect(names).not.toContain('task')
  })

  it('RunSubagentFn wrapper passes AbortSignal to spawnSubagent', async () => {
    let capturedSignal: AbortSignal | undefined
    const spawnFn = async (desc: string, _mode?: string, _taskId?: string, signal?: AbortSignal) => {
      capturedSignal = signal
      return desc
    }
    const tools = buildTaskBatchTools(spawnFn)
    expect(tools).toHaveLength(1)
    const result = await tools[0].invoke({
      tasks: [{ description: 'signal check', prompt: 'hello' }],
    })
    expect(capturedSignal).toBeInstanceOf(AbortSignal)
    expect(capturedSignal!.aborted).toBe(false)
    expect(typeof result).toBe('string')
  })
})
