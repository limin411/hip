/**
 * Unpaid long-run harness (M5): compact protect + goal persist + crash interrupt.
 * No live LLM. Run via: yarn test:longrun-unit
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import type { SessionConfig } from '@hip/protocol'
import { Session } from './session.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import { EventStore } from '../persistence/event-store.js'
import { projectEvent } from '../persistence/message-projector.js'
import { isAssistantStep } from '../persistence/message-types.js'
import { loadProjection } from '../persistence/message-projector.js'
import { compactMessages, appendProtectedStructures } from './compaction.js'
import { GoalManager } from './goal.js'
import { formatGoalProtectedBlock } from './goal-types.js'

const baseCfg: SessionConfig = {
  llmProvider: 'openai',
  model: 'gpt-4',
  tools: [],
  useEventSource: true,
}

function insertSession(store: SessionStore, id: string): void {
  store.insertSession({
    id,
    title: 't',
    config: JSON.stringify(baseCfg),
    createdAt: 1,
    updatedAt: 1,
  })
}

describe('longrun harness @longrun-unit', () => {
  let root: string
  let st: SessionStore
  let db: ReturnType<typeof openDatabase>['db']
  let eventStore: EventStore

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hip-longrun-'))
    const opened = openDatabase(':memory:')
    db = opened.db
    st = new SessionStore(db, opened.ftsEnabled)
    eventStore = new EventStore(db)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('goal survives session reconstruct (durable store)', () => {
    const id = 'lr-goal-1'
    insertSession(st, id)
    const s1 = new Session(id, { ...baseCfg, cwd: root }, undefined, st)
    s1.goalManager.create({
      description: 'Ship watchlist',
      successCriteria: ['migration', 'tests green'],
    })
    expect(st.loadSessionGoal(id)).toBeTruthy()

    const s2 = new Session(id, { ...baseCfg, cwd: root }, undefined, st)
    const g = s2.goalManager.getStatus()
    expect(g?.description).toBe('Ship watchlist')
    expect(g?.successCriteria).toEqual(['migration', 'tests green'])
  })

  it('compact summary retains protected goal block', async () => {
    const gm = new GoalManager()
    gm.create({
      description: 'Long feature',
      successCriteria: ['cargo test green'],
    })
    const block = formatGoalProtectedBlock(gm.getStatus())
    expect(block).toContain('cargo test green')

    const messages = [
      new HumanMessage({ id: 'h0', content: 'start' }),
      new AIMessage({ id: 'a0', content: 'working on files…' }),
      new HumanMessage({ id: 'h1', content: 'continue' }),
      new AIMessage({ id: 'a1', content: 'more work' }),
      new HumanMessage({ id: 'h2', content: 'still going' }),
      new AIMessage({ id: 'a2', content: 'almost' }),
      new HumanMessage({ id: 'h3', content: 'finish' }),
      new AIMessage({ id: 'a3', content: 'done-ish' }),
    ]
    const result = await compactMessages(messages, {
      keepRecentTurns: 1,
      summarizer: {
        async summarize() {
          return 'compressed middle history about implementation steps'
        },
      },
      protectedStructures: block,
    })
    expect(result).not.toBeNull()
    const summary =
      typeof result!.summary.content === 'string' ? result!.summary.content : ''
    expect(summary).toContain('Active goal')
    expect(summary).toContain('cargo test green')
    expect(appendProtectedStructures(summary, block)).toBe(summary)
  })

  it('crash recovery fails running tools (no silent replay)', () => {
    const sessionId = 'lr-crash-1'
    insertSession(st, sessionId)
    const pub = (type: string, data: Record<string, unknown>) => {
      db.exec('BEGIN')
      const event = eventStore.append(sessionId, type, data)
      projectEvent(db, event)
      db.exec('COMMIT')
    }
    pub('user_message', { messageId: 'u-1', content: 'hi', timestamp: 1 })
    pub('step_started', { stepId: 'a-1', agentId: 'supervisor', startedAt: 2 })
    pub('tool_called', { stepId: 'a-1', callId: 'c-write', name: 'write_file', input: '{}', seq: 3 })

    new Session(sessionId, { ...baseCfg, cwd: root }, undefined, st)

    const failed = eventStore.loadEvents(sessionId).filter((e) => e.type === 'tool_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0].data).toMatchObject({
      callId: 'c-write',
      error: 'interrupted by sidecar crash',
    })
    const rows = loadProjection(db, sessionId)
    const step = rows.find((r) => r.type === 'assistant')
    const tcs = step && isAssistantStep(step.data) ? step.data.toolCalls : []
    expect(tcs[0]?.status).toBe('error')
  })

  it('tryComplete requires verification when recipe set', () => {
    const gm = new GoalManager()
    gm.create({
      description: 'x',
      successCriteria: ['y'],
      verification: { commands: [{ id: 't', cmd: 'false' }] },
    })
    expect(gm.tryComplete()).toBe(false)
    expect(gm.getStatus()?.blockedReason).toBe('verification_required')
    gm.recordVerification({
      ok: true,
      at: Date.now(),
      results: [{ id: 't', cmd: 'true', exitCode: 0, durationMs: 1, ok: true }],
    })
    expect(gm.tryComplete()).toBe(true)
  })
})
