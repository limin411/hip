import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from '../../persistence/open.js'
import { MemoryStore } from '../store.js'
import { MemoryService } from '../service.js'
import { formatLearnNowDetail, runLearnNow } from './learn-now.js'
import type { MemoryLlmClient } from '../llm-client.js'
import type { Message } from '@hip/protocol'
import { MEMORY_FILE_CONFIG_DEFAULTS } from '@hip/protocol'
import { resetPhase1Queue } from './queue.js'

function longTranscript(): Message[] {
  return [
    {
      id: 'u1',
      role: 'user',
      content: 'We prefer TypeScript strict mode and always use yarn for this project.',
      timestamp: 1,
    },
    {
      id: 'a1',
      role: 'assistant',
      content: 'Understood, yarn and strict TS.',
      agentId: 'supervisor',
      timestamp: 2,
    },
    {
      id: 'u2',
      role: 'user',
      content: 'Also pin important preferences in core memory.',
      timestamp: 3,
    },
  ]
}

describe('runLearnNow', () => {
  let store: MemoryStore
  let svc: MemoryService
  let tmpDir: string

  beforeEach(() => {
    resetPhase1Queue()
    tmpDir = mkdtempSync(join(tmpdir(), 'hip-learn-now-'))
    const opened = openDatabase(':memory:')
    store = new MemoryStore(opened.db, opened.memoriesFtsEnabled)
    svc = new MemoryService(store, { configPath: join(tmpDir, 'memory.json') })
    svc.setConfig({
      ...MEMORY_FILE_CONFIG_DEFAULTS,
      generateMemories: true,
      useMemories: true,
      exportMarkdownMirror: false,
      minUserTurns: 2,
      minUserChars: 10,
      maxExtractsPerDay: 20,
    })
  })

  afterEach(() => {
    resetPhase1Queue()
    vi.restoreAllMocks()
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('phase2-only when stage1 already pending', async () => {
    const now = Date.now()
    store.upsertStage1({
      id: 'st-existing',
      sessionId: 's1',
      rawMemory: '- Prefer yarn',
      rolloutSummary: 'pkg',
      status: 'succeeded',
      sourceUpdatedAt: now,
      createdAt: now,
    })
    const llm: MemoryLlmClient = {
      completeJson: async () => ({
        items: [
          {
            action: 'upsert',
            title: 'Yarn',
            content: 'Prefer yarn',
            kind: 'convention',
            scope: 'global',
            confidence: 0.7,
          },
        ],
        summary_md: 'yarn',
      }),
    }
    const res = await runLearnNow({
      store,
      memoryService: svc,
      llm,
      config: svc.getConfig(),
      sessionStore: null,
    })
    expect(res.phase1.tried).toBe(0)
    expect(res.phase2.status).toBe('succeeded')
    expect(store.listItems({ status: 'active' }).some((i) => i.title === 'Yarn')).toBe(true)
  })

  it('dogfood: empty stage1 → extract recent session → consolidate items', async () => {
    const llm: MemoryLlmClient = {
      completeJson: async (sys) => {
        // Phase1 system prompt says "Phase1 only"; Phase2 also mentions raw_memory.
        if (String(sys).includes('Phase1 only')) {
          return {
            raw_memory: '- Prefer yarn for package management (dogfood-token-learn)',
            rollout_summary: 'package prefs',
          }
        }
        return {
          items: [
            {
              action: 'upsert',
              title: 'Package manager',
              content: 'Prefer yarn for package management (dogfood-token-learn)',
              kind: 'convention',
              scope: 'global',
              confidence: 0.75,
            },
          ],
          summary_md: 'Uses yarn.',
        }
      },
    }

    const sessionStore = {
      loadMessagesWithRuns: (id: string) => {
        if (id === 'sess-dogfood') return longTranscript()
        return []
      },
      listSessions: () => [
        {
          id: 'sess-dogfood',
          messageCount: 3,
          config: JSON.stringify({ generateMemories: true, cwd: '/tmp/proj' }),
        },
      ],
    }

    const res = await runLearnNow({
      store,
      memoryService: svc,
      llm,
      config: svc.getConfig(),
      sessionStore,
    })

    expect(res.phase1.tried).toBeGreaterThanOrEqual(1)
    expect(res.phase1.succeeded).toBe(1)
    expect(res.phase2.status).toBe('succeeded')
    expect(res.phase2.upserted).toBeGreaterThanOrEqual(1)

    const items = store.listItems({ status: 'active' })
    expect(items.some((i) => i.content.includes('dogfood-token-learn'))).toBe(true)

    const detail = formatLearnNowDetail(res)
    expect(detail).toMatch(/extracted=1/)
    expect(detail).toMatch(/upserted=/)
  })

  it('noop path: no sessions → no_stage1 with no_eligible_session', async () => {
    const llm: MemoryLlmClient = {
      completeJson: async () => ({ raw_memory: '', rollout_summary: '' }),
    }
    const res = await runLearnNow({
      store,
      memoryService: svc,
      llm,
      config: svc.getConfig(),
      sessionStore: {
        loadMessagesWithRuns: () => [],
        listSessions: () => [],
      },
    })
    expect(res.phase1.lastReason).toBe('no_eligible_session')
    expect(res.phase2.status).toBe('skipped')
    expect(res.phase2.reason).toBe('no_stage1')
  })

  it('no_llm when generate on and empty stage1', async () => {
    const res = await runLearnNow({
      store,
      memoryService: svc,
      llm: null,
      config: svc.getConfig(),
      sessionStore: {
        loadMessagesWithRuns: () => longTranscript(),
        listSessions: () => [{ id: 's', messageCount: 5, config: '{}' }],
      },
    })
    expect(res.phase1.lastReason).toBe('no_llm')
    expect(res.phase2.status).toBe('skipped')
  })
})
