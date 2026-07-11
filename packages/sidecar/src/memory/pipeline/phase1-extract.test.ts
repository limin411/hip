import { describe, it, expect, beforeEach } from 'vitest'
import type { MemoryFileConfig, Message } from '@hip/protocol'
import { MEMORY_FILE_CONFIG_DEFAULTS } from '@hip/protocol'
import { openDatabase } from '../../persistence/open.js'
import { MemoryStore } from '../store.js'
import type { MemoryLlmClient } from '../llm-client.js'
import { runPhase1Extract } from './phase1-extract.js'
import { redactSecrets } from '../redact.js'

function cfg(partial: Partial<MemoryFileConfig> = {}): MemoryFileConfig {
  return { ...MEMORY_FILE_CONFIG_DEFAULTS, generateMemories: true, ...partial }
}

function msg(partial: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>): Message {
  return { timestamp: 1, ...partial }
}

function enoughMessages(): Message[] {
  return [
    msg({ id: 'u1', role: 'user', content: 'We prefer TypeScript strict mode for this project.' }),
    msg({ id: 'a1', role: 'assistant', content: 'Understood, will use strict TypeScript.', agentId: 'supervisor' }),
    msg({ id: 'u2', role: 'user', content: 'Also use yarn not npm.' }),
    msg({
      id: 'a2',
      role: 'assistant',
      content: 'Got it — yarn only.',
      agentId: 'supervisor',
      agentRuns: [
        {
          agentId: 'supervisor',
          role: 'supervisor',
          output: 'Got it — yarn only.',
          startedAt: 1,
          finishedAt: 2,
          seq: 0,
        },
        {
          agentId: 'worker-1',
          role: 'worker',
          output: 'CHILD_SHOULD_NOT_BE_IN_TRANSCRIPT',
          startedAt: 1,
          finishedAt: 2,
          seq: 1,
          parentAgentId: 'supervisor',
        },
      ],
    }),
  ]
}

function loadStore() {
  const { db, memoriesFtsEnabled } = openDatabase(':memory:')
  return new MemoryStore(db, memoriesFtsEnabled)
}

function mockLlm(result: unknown): MemoryLlmClient {
  return {
    completeJson: async () => result,
  }
}

function stage1Row(store: MemoryStore, id: string) {
  return store.getDb().prepare(`SELECT * FROM memory_stage1 WHERE id=?`).get(id) as
    | {
        id: string
        session_id: string
        raw_memory: string
        rollout_summary: string
        rollout_slug: string | null
        status: string
      }
    | undefined
}

describe('runPhase1Extract', () => {
  let store: MemoryStore
  let messages: Message[]

  beforeEach(() => {
    store = loadStore()
    messages = enoughMessages()
  })

  const sessionStore = {
    loadMessagesWithRuns: (_id: string) => messages,
  }

  it('mock good JSON → stage1 row succeeded', async () => {
    const llm = mockLlm({
      raw_memory: '- Prefer TypeScript strict mode\n- Use yarn not npm',
      rollout_summary: 'User set package manager and TS preferences.',
      rollout_slug: 'ts-yarn-prefs',
    })
    const res = await runPhase1Extract({
      store,
      sessionStore,
      sessionId: 'sess-1',
      llm,
      config: cfg(),
      sessionConfig: { generateMemories: true, cwd: '/tmp/proj' },
      now: 1000,
    })
    expect(res.status).toBe('succeeded')
    expect(res.stage1Id).toBeTruthy()
    const row = stage1Row(store, res.stage1Id!)
    expect(row?.status).toBe('succeeded')
    expect(row?.raw_memory).toContain('TypeScript')
    expect(row?.rollout_summary).toContain('preferences')
    expect(row?.rollout_slug).toBe('ts-yarn-prefs')
  })

  it('empty raw+summary → succeeded_no_output', async () => {
    const llm = mockLlm({ raw_memory: '', rollout_summary: '' })
    const res = await runPhase1Extract({
      store,
      sessionStore,
      sessionId: 'sess-empty',
      llm,
      config: cfg(),
      sessionConfig: { generateMemories: true },
    })
    expect(res.status).toBe('succeeded_no_output')
    const row = stage1Row(store, res.stage1Id!)
    expect(row?.status).toBe('succeeded_no_output')
    expect(row?.raw_memory).toBe('')
    expect(row?.rollout_summary).toBe('')
  })

  it('generate false → skipped', async () => {
    const llm = mockLlm({ raw_memory: 'x', rollout_summary: 'y' })
    const res = await runPhase1Extract({
      store,
      sessionStore,
      sessionId: 'sess-off',
      llm,
      config: cfg({ generateMemories: false }),
      sessionConfig: { generateMemories: false },
    })
    expect(res).toEqual({ status: 'skipped', reason: 'generate_disabled' })
    const n = store.getDb().prepare(`SELECT COUNT(*) AS n FROM memory_stage1`).get() as { n: number }
    expect(n.n).toBe(0)
  })

  it('incognito → skipped', async () => {
    const llm = mockLlm({ raw_memory: 'x', rollout_summary: 'y' })
    const res = await runPhase1Extract({
      store,
      sessionStore,
      sessionId: 'sess-incog',
      llm,
      config: cfg(),
      sessionConfig: { generateMemories: true, incognito: true },
    })
    expect(res).toEqual({ status: 'skipped', reason: 'incognito' })
  })

  it('min turns not met → skipped', async () => {
    messages = [msg({ id: 'u1', role: 'user', content: 'hi' })]
    const llm = mockLlm({ raw_memory: 'x', rollout_summary: 'y' })
    const res = await runPhase1Extract({
      store,
      sessionStore,
      sessionId: 'sess-min',
      llm,
      config: cfg({ minUserTurns: 2, minUserChars: 80 }),
      sessionConfig: { generateMemories: true },
    })
    expect(res).toEqual({ status: 'skipped', reason: 'min_content' })
  })

  it('no llm → skipped', async () => {
    const res = await runPhase1Extract({
      store,
      sessionStore,
      sessionId: 'sess-nollm',
      llm: null,
      config: cfg(),
      sessionConfig: { generateMemories: true },
    })
    expect(res).toEqual({ status: 'skipped', reason: 'no_llm' })
  })

  it('redact applied before stage1 write', async () => {
    const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456'
    const llm = mockLlm({
      raw_memory: `API key is ${secret}`,
      rollout_summary: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc used`,
    })
    const res = await runPhase1Extract({
      store,
      sessionStore,
      sessionId: 'sess-redact',
      llm,
      config: cfg(),
      sessionConfig: { generateMemories: true },
    })
    expect(res.status).toBe('succeeded')
    const row = stage1Row(store, res.stage1Id!)
    expect(row?.raw_memory).not.toContain(secret)
    expect(row?.raw_memory).toContain('[REDACTED_SECRET]')
    expect(row?.rollout_summary).toMatch(/Bearer \[REDACTED_SECRET\]/)
    // Sanity: same as direct redact
    expect(row?.raw_memory).toBe(redactSecrets(`API key is ${secret}`))
  })

  it('transcript path excludes parent_agent_id child content via messages', async () => {
    let seenUser = ''
    const llm: MemoryLlmClient = {
      completeJson: async (_system, user) => {
        seenUser = user
        return { raw_memory: 'ok', rollout_summary: 'ok' }
      },
    }
    // Add a separate child assistant message that must not appear in the user prompt.
    messages = [
      ...enoughMessages(),
      msg({
        id: 'a-child',
        role: 'assistant',
        content: 'PARENT_AGENT_CHILD_ONLY_CONTENT',
        agentId: 'worker-2',
        agentRuns: [
          {
            agentId: 'worker-2',
            role: 'worker',
            output: 'PARENT_AGENT_CHILD_ONLY_CONTENT',
            startedAt: 1,
            finishedAt: 2,
            seq: 0,
            parentAgentId: 'supervisor',
          },
        ],
      }),
    ]
    await runPhase1Extract({
      store,
      sessionStore,
      sessionId: 'sess-tx',
      llm,
      config: cfg(),
      sessionConfig: { generateMemories: true },
    })
    expect(seenUser).not.toContain('PARENT_AGENT_CHILD_ONLY_CONTENT')
    expect(seenUser).not.toContain('CHILD_SHOULD_NOT_BE_IN_TRANSCRIPT')
    expect(seenUser).toContain('TypeScript')
  })

  it('LLM throw → failed status', async () => {
    const llm: MemoryLlmClient = {
      completeJson: async () => {
        throw new Error('boom')
      },
    }
    const res = await runPhase1Extract({
      store,
      sessionStore,
      sessionId: 'sess-fail',
      llm,
      config: cfg(),
      sessionConfig: { generateMemories: true },
    })
    expect(res.status).toBe('failed')
    expect(res.reason).toContain('boom')
    const row = stage1Row(store, res.stage1Id!)
    expect(row?.status).toBe('failed')
  })
})
