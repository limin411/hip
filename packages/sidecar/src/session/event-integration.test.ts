import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, type BaseMessage, type AIMessage as AIMsg } from '@langchain/core/messages'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import { EventStore } from '../persistence/event-store.js'
import { loadProjection } from '../persistence/message-projector.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [] }

function store() {
  const { db, ftsEnabled } = openDatabase(':memory:')
  return { db, store: new SessionStore(db, ftsEnabled), eventStore: new EventStore(db) }
}

function textRunner(text: string): ModelRunner {
  return {
    async run(_m: BaseMessage[], o: ModelRunOptions) {
      o.onText(text)
      return new AIMessage(text)
    },
  }
}

function toolRunner(script: AIMsg[]): ModelRunner {
  let i = 0
  return {
    async run(_m: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
      const m = script[Math.min(i, script.length - 1)]
      i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

describe('Session event integration', () => {
  let db: ReturnType<typeof openDatabase>['db']
  let st: SessionStore
  let eventStore: EventStore
  let root: string

  beforeEach(() => {
    const opened = openDatabase(':memory:')
    db = opened.db
    st = new SessionStore(db, opened.ftsEnabled)
    eventStore = new EventStore(db)
    st.insertSession({ id: 's1', title: 't', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 })
    root = mkdtempSync(join(tmpdir(), 'hip-event-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('sendMessage publishes user_message event and updates both old and projected stores', async () => {
    const session = new Session('s1', { ...cfg, cwd: root }, undefined, st)
    await session.sendMessage('hello', () => {}, 'u-1')

    const oldMessages = st.loadMessages('s1')
    expect(oldMessages[0]).toMatchObject({ id: 'u-1', role: 'user', content: 'hello' })

    const events = eventStore.loadEvents('s1')
    expect(events.map((e) => e.type)).toContain('user_message')

    const projection = loadProjection(db, 's1')
    expect(projection.some((r) => r.type === 'user' && r.data.role === 'user' && r.data.content === 'hello')).toBe(true)
  })

  it('agent turn emits step_started and text events', async () => {
    const session = new Session('s1', { ...cfg, cwd: root }, undefined, st, undefined, undefined, textRunner('hi there'))
    await session.sendMessage('question', () => {}, 'u-1')

    const events = eventStore.loadEvents('s1')
    expect(events.some((e) => e.type === 'step_started')).toBe(true)
    expect(events.some((e) => e.type === 'text_started')).toBe(true)
    expect(events.some((e) => e.type === 'text_ended' && e.data.content === 'hi there')).toBe(true)
    expect(events.some((e) => e.type === 'step_ended')).toBe(true)
  })

  it('tool call emits tool_called and tool_success events', async () => {
    const session = new Session(
      's1',
      { ...cfg, cwd: root },
      undefined,
      st,
      undefined,
      undefined,
      toolRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: root }, id: 'c1' }] }),
        new AIMessage('done'),
      ]),
    )
    await session.sendMessage('list files', () => {}, 'u-1')

    const events = eventStore.loadEvents('s1')
    expect(events.some((e) => e.type === 'tool_called' && e.data.name === 'ls')).toBe(true)
    expect(events.some((e) => e.type === 'tool_success')).toBe(true)
  })

  it('loadMessages still returns correct data from legacy table', async () => {
    const session = new Session('s1', { ...cfg, cwd: root }, undefined, st, undefined, undefined, textRunner('reply'))
    await session.sendMessage('hi', () => {}, 'u-1')

    const messages = st.loadMessages('s1')
    expect(messages[0]).toMatchObject({ id: 'u-1', role: 'user', content: 'hi' })
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', content: 'reply' })
  })

  it('rolls back legacy write when event append fails', async () => {
    const session = new Session('s1', { ...cfg, cwd: root }, undefined, st)
    const brokenEventStore = new EventStore(db)
    brokenEventStore.append = () => {
      throw new Error('disk full')
    }
    ;(session as unknown as { eventStore?: EventStore }).eventStore = brokenEventStore

    await expect(session.sendMessage('boom', () => {}, 'u-2')).rejects.toThrow()

    expect(st.loadMessages('s1')).toHaveLength(0)
    expect(eventStore.loadEvents('s1')).toHaveLength(0)
  })
})
