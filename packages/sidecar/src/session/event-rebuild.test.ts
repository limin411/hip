import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { SessionConfig } from '@hip/protocol'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import { EventStore } from '../persistence/event-store.js'
import { projectEvent } from '../persistence/message-projector.js'

const baseCfg: SessionConfig = { llmProvider: 'openai', model: 'gpt-4', tools: [], useEventSource: true }

function makeStore() {
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

function capturingRunner(): { runner: ModelRunner; captured: BaseMessage[][]; output: string } {
  const captured: BaseMessage[][] = []
  let i = 0
  return {
    captured,
    output: 'reply',
    runner: {
      async run(messages: BaseMessage[], o: ModelRunOptions): Promise<AIMessage> {
        captured.push(messages)
        i++
        o.onText(`reply-${i}`)
        return new AIMessage(`reply-${i}`)
      },
    },
  }
}

function publishEvent(
  db: ReturnType<typeof openDatabase>['db'],
  eventStore: EventStore,
  sessionId: string,
  type: string,
  data: Record<string, unknown>,
): void {
  db.exec('BEGIN')
  const event = eventStore.append(sessionId, type, data)
  projectEvent(db, event)
  db.exec('COMMIT')
}

function getMessages(session: Session): BaseMessage[] {
  return (session as unknown as { messages: BaseMessage[] }).messages
}

function contentOf(m: BaseMessage): string {
  return typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
}

describe('LangGraph ↔ event-store boundary', () => {
  let db: ReturnType<typeof openDatabase>['db']
  let st: SessionStore
  let eventStore: EventStore
  let root: string

  beforeEach(() => {
    const opened = openDatabase(':memory:')
    db = opened.db
    st = new SessionStore(db, opened.ftsEnabled)
    eventStore = new EventStore(db)
    st.insertSession({ id: 's1', title: 't', config: JSON.stringify(baseCfg), createdAt: 1, updatedAt: 1 })
    root = mkdtempSync(join(tmpdir(), 'hip-rebuild-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('hydrate() with projection rows rebuilds HumanMessage + AIMessage correctly', () => {
    publishEvent(db, eventStore, 's1', 'user_message', { messageId: 'u-1', content: 'hello', timestamp: 1 })
    publishEvent(db, eventStore, 's1', 'step_started', { stepId: 'a-1', agentId: 'supervisor', startedAt: 2 })
    publishEvent(db, eventStore, 's1', 'text_ended', { stepId: 'a-1', content: 'world', timestamp: 3 })

    const session = new Session('s1', { ...baseCfg, cwd: root }, undefined, st)
    session.hydrate()

    const messages = getMessages(session)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toBeInstanceOf(HumanMessage)
    expect(contentOf(messages[0])).toBe('hello')
    expect(messages[1]).toBeInstanceOf(AIMessage)
    expect(contentOf(messages[1])).toBe('world')
  })

  it('hydrate() with empty projection but legacy messages falls back to old table', () => {
    st.insertMessage({ id: 'u-old', sessionId: 's1', role: 'user', agentId: null, content: 'legacy', timestamp: 1 })

    const session = new Session('s1', { ...baseCfg, cwd: root }, undefined, st)
    session.hydrate()

    const messages = getMessages(session)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toBeInstanceOf(HumanMessage)
    expect(contentOf(messages[0])).toBe('legacy')
  })

  it('hydrate() prefers projection over explicitly passed legacy messages', () => {
    st.insertMessage({ id: 'u-old', sessionId: 's1', role: 'user', agentId: null, content: 'legacy', timestamp: 1 })
    publishEvent(db, eventStore, 's1', 'user_message', { messageId: 'u-1', content: 'event', timestamp: 1 })

    const session = new Session('s1', { ...baseCfg, cwd: root }, undefined, st)
    session.hydrate(st.loadMessages('s1'))

    const messages = getMessages(session)
    expect(messages).toHaveLength(1)
    expect(contentOf(messages[0])).toBe('event')
  })

  it('runTurn() after projection load starts graph with correct message history', async () => {
    publishEvent(db, eventStore, 's1', 'user_message', { messageId: 'u-1', content: 'hello', timestamp: 1 })
    publishEvent(db, eventStore, 's1', 'step_started', { stepId: 'a-1', agentId: 'supervisor', startedAt: 2 })
    publishEvent(db, eventStore, 's1', 'text_ended', { stepId: 'a-1', content: 'old', timestamp: 3 })

    const { runner, captured } = capturingRunner()
    const session = new Session('s1', { ...baseCfg, cwd: root, disablePlan: true }, undefined, st, undefined, undefined, runner)
    await session.hydrate()
    await session.sendMessage('next', () => {}, 'u-2')

    expect(captured.length).toBeGreaterThan(0)
    const first = captured[0]
    expect(first.some((m) => m instanceof HumanMessage && m.content === 'hello')).toBe(true)
    expect(first.some((m) => m instanceof AIMessage && m.content === 'old')).toBe(true)
    expect(first.some((m) => m instanceof HumanMessage && m.content === 'next')).toBe(true)
  })

  it('restart simulation: new Session instance loads state from projection and continues turn', async () => {
    const firstRunner = textRunner('first')
    const session1 = new Session('s1', { ...baseCfg, cwd: root, disablePlan: true }, undefined, st, undefined, undefined, firstRunner)
    await session1.sendMessage('hi', () => {}, 'u-1')

    const { runner, captured } = capturingRunner()
    const session2 = new Session('s1', { ...baseCfg, cwd: root, disablePlan: true }, undefined, st, undefined, undefined, runner)
    await session2.hydrate()
    await session2.sendMessage('next', () => {}, 'u-2')

    expect(captured.length).toBeGreaterThan(0)
    const first = captured[0]
    expect(first.some((m) => m instanceof HumanMessage && m.content === 'hi')).toBe(true)
    expect(first.some((m) => m instanceof AIMessage && m.content === 'first')).toBe(true)
    expect(first.some((m) => m instanceof HumanMessage && m.content === 'next')).toBe(true)
  })

  it('projection row with tool calls becomes AIMessage with tool_calls metadata', () => {
    publishEvent(db, eventStore, 's1', 'user_message', { messageId: 'u-1', content: 'hi', timestamp: 1 })
    publishEvent(db, eventStore, 's1', 'step_started', { stepId: 'a-1', agentId: 'supervisor', startedAt: 2 })
    publishEvent(db, eventStore, 's1', 'tool_called', { callId: 'c-1', stepId: 'a-1', name: 'ls', input: '{"path":"/"}', seq: 3 })
    publishEvent(db, eventStore, 's1', 'tool_success', { callId: 'c-1', stepId: 'a-1', output: 'a b c' })
    publishEvent(db, eventStore, 's1', 'text_ended', { stepId: 'a-1', content: 'done', timestamp: 4 })

    const session = new Session('s1', { ...baseCfg, cwd: root }, undefined, st)
    session.hydrate()

    const messages = getMessages(session)
    expect(messages).toHaveLength(3)
    const assistant = messages[1]
    expect(assistant).toBeInstanceOf(AIMessage)
    const ai = assistant as AIMessage
    expect(ai.tool_calls).toHaveLength(1)
    expect(ai.tool_calls?.[0].name).toBe('ls')
    expect(ai.tool_calls?.[0].id).toBe('c-1')
    const tool = messages[2]
    expect(tool).toBeInstanceOf(ToolMessage)
    expect((tool as ToolMessage).tool_call_id).toBe('c-1')
    expect((tool as ToolMessage).content).toBe('a b c')
  })

  it('projection row with errored tool calls synthesizes error ToolMessages', () => {
    publishEvent(db, eventStore, 's1', 'user_message', { messageId: 'u-1', content: 'hi', timestamp: 1 })
    publishEvent(db, eventStore, 's1', 'step_started', { stepId: 'a-1', agentId: 'supervisor', startedAt: 2 })
    publishEvent(db, eventStore, 's1', 'tool_called', { callId: 'c-1', stepId: 'a-1', name: 'ls', input: '{"path":"/"}', seq: 3 })
    publishEvent(db, eventStore, 's1', 'tool_failed', { callId: 'c-1', stepId: 'a-1', error: 'boom' })

    const session = new Session('s1', { ...baseCfg, cwd: root }, undefined, st)
    session.hydrate()

    const messages = getMessages(session)
    expect(messages).toHaveLength(3)
    const tool = messages[2] as ToolMessage
    expect(tool.tool_call_id).toBe('c-1')
    expect(tool.content).toBe('Error: boom')
  })

  it('compaction projection row becomes SystemMessage', () => {
    publishEvent(db, eventStore, 's1', 'user_message', { messageId: 'u-1', content: 'hi', timestamp: 1 })
    publishEvent(db, eventStore, 's1', 'compaction_ended', { summary: 'summary text', timestamp: 2 })

    const session = new Session('s1', { ...baseCfg, cwd: root }, undefined, st)
    session.hydrate()

    const messages = getMessages(session)
    expect(messages[1]).toBeInstanceOf(SystemMessage)
    expect(contentOf(messages[1])).toBe('summary text')
  })
})
