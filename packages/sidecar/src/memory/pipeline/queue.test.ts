import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { MemoryFileConfig, Message } from '@hip/protocol'
import { MEMORY_FILE_CONFIG_DEFAULTS } from '@hip/protocol'
import { openDatabase } from '../../persistence/open.js'
import { MemoryStore } from '../store.js'
import type { MemoryLlmClient } from '../llm-client.js'
import {
  enqueuePhase1,
  processQueue,
  resetPhase1Queue,
  maybeEnqueueMemoryExtract,
  scheduleMemoryExtractAfterTurn,
  setLastExtractSuccessAt,
  assertUnderDailyExtractLimit,
  recordExtractSuccess,
} from './queue.js'
import * as llmClient from '../llm-client.js'
import { MemoryService } from '../service.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function cfg(partial: Partial<MemoryFileConfig> = {}): MemoryFileConfig {
  return { ...MEMORY_FILE_CONFIG_DEFAULTS, generateMemories: true, ...partial }
}

describe('phase1 queue', () => {
  let store: MemoryStore
  let configDir: string

  beforeEach(() => {
    resetPhase1Queue()
    const { db, memoriesFtsEnabled } = openDatabase(':memory:')
    store = new MemoryStore(db, memoriesFtsEnabled)
    configDir = mkdtempSync(join(tmpdir(), 'hip-mem-q-'))
  })

  afterEach(() => {
    resetPhase1Queue()
    rmSync(configDir, { recursive: true, force: true })
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('processes jobs with concurrency 1 and writes stage1', async () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'Prefer strict TypeScript always.', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'ok', agentId: 'supervisor', timestamp: 2 },
      { id: 'u2', role: 'user', content: 'And use yarn.', timestamp: 3 },
    ]
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const llm: MemoryLlmClient = {
      completeJson: async () => {
        await gate
        return {
          raw_memory: '- strict TS',
          rollout_summary: 'prefs',
        }
      },
    }
    const sessionStore = { loadMessagesWithRuns: () => messages }
    const ok = enqueuePhase1({
      sessionId: 's1',
      store,
      sessionStore,
      llm,
      config: cfg(),
      sessionConfig: { generateMemories: true },
    })
    expect(ok).toBe(true)
    // Dedup while inflight (job held by gate)
    expect(
      enqueuePhase1({
        sessionId: 's1',
        store,
        sessionStore,
        llm,
        config: cfg(),
      }),
    ).toBe(false)

    release()
    // Allow the auto-started processQueue (and any re-entry) to finish.
    await new Promise((r) => setTimeout(r, 50))
    await processQueue()

    const n = store.getDb().prepare(`SELECT COUNT(*) AS n FROM memory_stage1 WHERE session_id='s1'`).get() as {
      n: number
    }
    expect(n.n).toBe(1)
  })

  it('maybeEnqueueMemoryExtract skips when generate false', () => {
    const configPath = join(configDir, 'memory.json')
    const svc = new MemoryService(store, { configPath })
    svc.setConfig({ generateMemories: false })
    maybeEnqueueMemoryExtract({
      id: 's-off',
      _config: { generateMemories: false },
      store: { loadMessagesWithRuns: () => [] },
      memoryService: svc,
    })
    // Nothing queued that would write
    expect(store.getDb().prepare(`SELECT COUNT(*) AS n FROM memory_stage1`).get()).toEqual({ n: 0 })
  })

  it('maybeEnqueueMemoryExtract skips incognito', () => {
    const configPath = join(configDir, 'memory.json')
    const svc = new MemoryService(store, { configPath })
    svc.setConfig({ generateMemories: true })
    maybeEnqueueMemoryExtract({
      id: 's-incog',
      _config: { generateMemories: true, incognito: true },
      store: { loadMessagesWithRuns: () => [] },
      memoryService: svc,
    })
    expect(store.getDb().prepare(`SELECT COUNT(*) AS n FROM memory_stage1`).get()).toEqual({ n: 0 })
  })

  it('maybeEnqueueMemoryExtract skips within minExtractIntervalHours', () => {
    const configPath = join(configDir, 'memory.json')
    const svc = new MemoryService(store, { configPath })
    svc.setConfig({ generateMemories: true, minExtractIntervalHours: 6 })
    setLastExtractSuccessAt('s-recent', Date.now() - 60_000) // 1 min ago
    maybeEnqueueMemoryExtract({
      id: 's-recent',
      _config: { generateMemories: true },
      store: { loadMessagesWithRuns: () => [] },
      memoryService: svc,
    })
    // No stage1 and no inflight enqueue that would process without LLM; queue stays empty.
    expect(store.getDb().prepare(`SELECT COUNT(*) AS n FROM memory_stage1`).get()).toEqual({ n: 0 })
  })

  it('scheduleMemoryExtractAfterTurn debounces until idleMinutes', async () => {
    vi.useFakeTimers()
    const configPath = join(configDir, 'memory.json')
    const svc = new MemoryService(store, { configPath })
    // short idle for test; generate on; simpleExtract so phase2 doesn't need LLM either
    // but maybeEnqueue still needs a real LLM client — without keys it no-ops.
    // We only assert debounce scheduling doesn't immediately write stage1.
    svc.setConfig({ generateMemories: true, idleMinutes: 15 })

    const host = {
      id: 's-debounce',
      _config: { generateMemories: true },
      store: { loadMessagesWithRuns: () => [] as Message[] },
      memoryService: svc,
    }
    scheduleMemoryExtractAfterTurn(host)
    // Immediate: nothing enqueued yet
    expect(store.getDb().prepare(`SELECT COUNT(*) AS n FROM memory_stage1`).get()).toEqual({ n: 0 })

    // New turn resets timer
    scheduleMemoryExtractAfterTurn(host)
    await vi.advanceTimersByTimeAsync(14 * 60_000)
    expect(store.getDb().prepare(`SELECT COUNT(*) AS n FROM memory_stage1`).get()).toEqual({ n: 0 })

    // After full idle window, timer fires (may no-op without LLM key — that's ok)
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    // No throw; debounce path completed
  })

  it('idleMinutes 0 schedules extract on next timer turn (not coerced to 15)', async () => {
    vi.useFakeTimers()
    const configPath = join(configDir, 'memory.json')
    const svc = new MemoryService(store, { configPath })
    svc.setConfig({
      generateMemories: true,
      idleMinutes: 0,
      minExtractIntervalHours: 0,
    })
    expect(svc.getConfig().idleMinutes).toBe(0)

    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'Prefer strict TypeScript always for this monorepo.', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'Understood.', agentId: 'supervisor', timestamp: 2 },
      { id: 'u2', role: 'user', content: 'Also always use yarn, never npm.', timestamp: 3 },
    ]
    let createClientCalls = 0
    const completeJson = vi.fn(async () => ({
      raw_memory: '- Prefer yarn and strict TS',
      rollout_summary: 'prefs',
    }))
    vi.spyOn(llmClient, 'createDefaultMemoryLlmClient').mockImplementation(() => {
      createClientCalls += 1
      return { completeJson }
    })

    const host = {
      id: 's-idle-zero',
      _config: { generateMemories: true },
      store: { loadMessagesWithRuns: () => messages },
      memoryService: svc,
    }

    scheduleMemoryExtractAfterTurn(host)
    expect(createClientCalls).toBe(0)

    await vi.advanceTimersByTimeAsync(0)
    await processQueue()
    await Promise.resolve()

    expect(createClientCalls).toBe(1)
    expect(completeJson).toHaveBeenCalled()
  })

  it('idleMinutes 0 still debounces two schedules into one extract', async () => {
    vi.useFakeTimers()
    const configPath = join(configDir, 'memory.json')
    const svc = new MemoryService(store, { configPath })
    svc.setConfig({
      generateMemories: true,
      idleMinutes: 0,
      minExtractIntervalHours: 0,
    })

    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'Prefer strict TypeScript always for this monorepo.', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'Understood.', agentId: 'supervisor', timestamp: 2 },
      { id: 'u2', role: 'user', content: 'Also always use yarn, never npm.', timestamp: 3 },
    ]
    let createClientCalls = 0
    vi.spyOn(llmClient, 'createDefaultMemoryLlmClient').mockImplementation(() => {
      createClientCalls += 1
      return {
        completeJson: async () => ({
          raw_memory: '- Prefer yarn',
          rollout_summary: 'prefs',
        }),
      }
    })

    const host = {
      id: 's-idle-zero-debounce',
      _config: { generateMemories: true },
      store: { loadMessagesWithRuns: () => messages },
      memoryService: svc,
    }

    scheduleMemoryExtractAfterTurn(host)
    scheduleMemoryExtractAfterTurn(host)
    expect(createClientCalls).toBe(0)

    await vi.advanceTimersByTimeAsync(0)
    await processQueue()
    await Promise.resolve()

    expect(createClientCalls).toBe(1)
  })

  it('minExtractIntervalHours 0 does not block immediate re-enqueue after success', async () => {
    const configPath = join(configDir, 'memory.json')
    const svc = new MemoryService(store, { configPath })
    svc.setConfig({
      generateMemories: true,
      minExtractIntervalHours: 0,
      maxExtractsPerDay: 20,
    })

    setLastExtractSuccessAt('s-interval-zero', Date.now() - 1)

    const llmSpy = vi.spyOn(llmClient, 'createDefaultMemoryLlmClient').mockReturnValue({
      completeJson: async () => ({ raw_memory: '- x', rollout_summary: 'y' }),
    })

    maybeEnqueueMemoryExtract({
      id: 's-interval-zero',
      _config: { generateMemories: true },
      store: {
        loadMessagesWithRuns: () => [
          { id: 'u1', role: 'user', content: 'Prefer strict TypeScript always for this monorepo.', timestamp: 1 },
          { id: 'a1', role: 'assistant', content: 'ok', agentId: 'supervisor', timestamp: 2 },
          { id: 'u2', role: 'user', content: 'Use yarn always.', timestamp: 3 },
        ],
      },
      memoryService: svc,
    })

    expect(llmSpy).toHaveBeenCalled()
    llmSpy.mockRestore()
  })

  it('MEMORY_FILE_CONFIG_DEFAULTS keep production idle 15 and interval 6', () => {
    expect(MEMORY_FILE_CONFIG_DEFAULTS.idleMinutes).toBe(15)
    expect(MEMORY_FILE_CONFIG_DEFAULTS.minExtractIntervalHours).toBe(6)
  })

  it('assertUnderDailyExtractLimit / recordExtractSuccess track UTC day', () => {
    const dayA = Date.UTC(2026, 0, 1, 12, 0, 0)
    const dayB = Date.UTC(2026, 0, 2, 1, 0, 0)
    expect(assertUnderDailyExtractLimit(cfg({ maxExtractsPerDay: 2 }), dayA)).toBe(true)
    recordExtractSuccess(dayA)
    recordExtractSuccess(dayA)
    expect(assertUnderDailyExtractLimit(cfg({ maxExtractsPerDay: 2 }), dayA)).toBe(false)
    // New UTC day resets counter
    expect(assertUnderDailyExtractLimit(cfg({ maxExtractsPerDay: 2 }), dayB)).toBe(true)
  })

  it('maybeEnqueueMemoryExtract skips when daily extract limit reached', () => {
    const configPath = join(configDir, 'memory.json')
    const svc = new MemoryService(store, { configPath })
    svc.setConfig({ generateMemories: true, maxExtractsPerDay: 1 })
    recordExtractSuccess()

    const llmSpy = vi.spyOn(llmClient, 'createDefaultMemoryLlmClient').mockReturnValue({
      completeJson: async () => ({ raw_memory: '- x', rollout_summary: 'y' }),
    })

    maybeEnqueueMemoryExtract({
      id: 's-rate',
      _config: { generateMemories: true },
      store: { loadMessagesWithRuns: () => [] },
      memoryService: svc,
    })
    expect(llmSpy).not.toHaveBeenCalled()
    expect(store.getDb().prepare(`SELECT COUNT(*) AS n FROM memory_stage1`).get()).toEqual({ n: 0 })
    llmSpy.mockRestore()
  })

  it('processQueue records extract success toward daily limit', async () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'Prefer strict TypeScript always and forever.', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'ok', agentId: 'supervisor', timestamp: 2 },
      { id: 'u2', role: 'user', content: 'And use yarn for all installs.', timestamp: 3 },
    ]
    const llm: MemoryLlmClient = {
      completeJson: async () => ({
        raw_memory: '- strict TS',
        rollout_summary: 'prefs',
      }),
    }
    const limited = cfg({ maxExtractsPerDay: 1 })
    expect(assertUnderDailyExtractLimit(limited)).toBe(true)
    enqueuePhase1({
      sessionId: 's-count',
      store,
      sessionStore: { loadMessagesWithRuns: () => messages },
      llm,
      config: limited,
      sessionConfig: { generateMemories: true },
    })
    await new Promise((r) => setTimeout(r, 50))
    await processQueue()
    expect(assertUnderDailyExtractLimit(limited)).toBe(false)
  })
})
