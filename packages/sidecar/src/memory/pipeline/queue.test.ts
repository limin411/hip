import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
} from './queue.js'
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
})
