import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MemoryFileConfig } from '@hip/protocol'
import { flushMemoryBeforeCompact, MEMORY_FLUSH_TIMEOUT_MS } from './flush-before-compact.js'
import type { MemoryService } from '../service.js'
import type { MemoryStore } from '../store.js'
import * as phase1 from './phase1-extract.js'
import * as llmClient from '../llm-client.js'
import * as queue from './queue.js'

const baseConfig: MemoryFileConfig = {
  generateMemories: true,
  useMemories: true,
  maxExtractsPerDay: 100,
  minUserTurns: 1,
  minUserChars: 1,
} as MemoryFileConfig

function mockService(overrides?: Partial<MemoryService>): MemoryService {
  return {
    getConfig: () => baseConfig,
    recordPipelineStatus: vi.fn(),
    store: {} as MemoryStore,
    ...overrides,
  } as unknown as MemoryService
}

describe('flushMemoryBeforeCompact', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('skips when generate is disabled', async () => {
    const svc = mockService({
      getConfig: () => ({ ...baseConfig, generateMemories: false }) as MemoryFileConfig,
    })
    const res = await flushMemoryBeforeCompact({
      sessionId: 's1',
      store: {} as MemoryStore,
      sessionStore: { loadMessagesWithRuns: () => [] },
      memoryService: svc,
      sessionConfig: { generateMemories: false },
    })
    expect(res.status).toBe('skipped')
    expect(res.reason).toBe('generate_disabled')
  })

  it('skips when no LLM client', async () => {
    vi.spyOn(llmClient, 'createDefaultMemoryLlmClient').mockReturnValue(null)
    vi.spyOn(queue, 'assertUnderDailyExtractLimit').mockReturnValue(true)
    const svc = mockService()
    const res = await flushMemoryBeforeCompact({
      sessionId: 's1',
      store: {} as MemoryStore,
      sessionStore: { loadMessagesWithRuns: () => [] },
      memoryService: svc,
    })
    expect(res.status).toBe('skipped')
    expect(res.reason).toBe('no_llm')
  })

  it('returns flushed on phase1 success', async () => {
    vi.spyOn(llmClient, 'createDefaultMemoryLlmClient').mockReturnValue({
      completeJson: async () => ({}),
    })
    vi.spyOn(queue, 'assertUnderDailyExtractLimit').mockReturnValue(true)
    vi.spyOn(queue, 'recordExtractSuccess').mockImplementation(() => {})
    vi.spyOn(phase1, 'runPhase1Extract').mockResolvedValue({
      status: 'succeeded',
      stage1Id: 'st1',
    })
    const svc = mockService()
    const res = await flushMemoryBeforeCompact({
      sessionId: 's1',
      store: {} as MemoryStore,
      sessionStore: { loadMessagesWithRuns: () => [] },
      memoryService: svc,
    })
    expect(res.status).toBe('flushed')
    expect(res.phase1?.status).toBe('succeeded')
    expect(queue.recordExtractSuccess).toHaveBeenCalled()
  })

  it('times out when phase1 is slow', async () => {
    vi.spyOn(llmClient, 'createDefaultMemoryLlmClient').mockReturnValue({
      completeJson: async () => ({}),
    })
    vi.spyOn(queue, 'assertUnderDailyExtractLimit').mockReturnValue(true)
    vi.spyOn(phase1, 'runPhase1Extract').mockImplementation(
      () => new Promise(() => { /* never resolves */ }),
    )
    const svc = mockService()
    const res = await flushMemoryBeforeCompact({
      sessionId: 's1',
      store: {} as MemoryStore,
      sessionStore: { loadMessagesWithRuns: () => [] },
      memoryService: svc,
      timeoutMs: 30,
    })
    expect(res.status).toBe('timeout')
    expect(MEMORY_FLUSH_TIMEOUT_MS).toBeGreaterThan(0)
  })
})
