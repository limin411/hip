import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from './open.js'
import { SessionStore } from './store.js'

function freshStore() {
  const { db, ftsEnabled } = openDatabase(':memory:')
  return new SessionStore(db, ftsEnabled)
}

const cfg = JSON.stringify({ llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] })

describe('SessionStore', () => {
  let store: SessionStore
  beforeEach(() => { store = freshStore() })

  it('inserts and lists sessions newest-first with preview + count', () => {
    store.insertSession({ id: 's1', title: '新对话', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'm1', sessionId: 's1', role: 'user', agentId: null, content: '你好世界', timestamp: 2 })
    store.touchSession('s1', 2)
    const list = store.listSessions()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 's1', preview: '你好世界', messageCount: 1, updatedAt: 2 })
  })

  it('assigns monotonic seq per session', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    expect(store.insertMessage({ id: 'a', sessionId: 's1', role: 'user', agentId: null, content: 'x', timestamp: 1 })).toBe(1)
    expect(store.insertMessage({ id: 'b', sessionId: 's1', role: 'assistant', agentId: 'supervisor', content: 'y', timestamp: 2 })).toBe(2)
  })

  it('insertTurn writes assistant message + linked agent_runs atomically', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn(
      { id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'done', timestamp: 3 },
      's1',
      [{ agentId: 'planner', role: 'planner', output: 'plan', startedAt: 1, finishedAt: 2, seq: 0 },
       { agentId: 'supervisor', role: 'supervisor', output: 'done', startedAt: 1, finishedAt: 3, seq: 1 }],
    )
    expect(store.loadMessages('s1').map((m) => m.id)).toEqual(['u1', 'a1'])
    const runs = store.loadAgentRuns('s1')
    expect(runs.map((r) => r.agentId)).toEqual(['planner', 'supervisor'])
    expect(runs[0]).toMatchObject({ output: 'plan', startedAt: 1, finishedAt: 2, seq: 0 })
  })

  it('loadMessages returns protocol Message shape (agentId undefined for user)', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 7 })
    expect(store.loadMessages('s1')[0]).toEqual({ id: 'u1', role: 'user', content: 'hi', agentId: undefined, timestamp: 7 })
  })

  it('search finds a Chinese substring via FTS and returns a snippet', () => {
    store.insertSession({ id: 's1', title: '关于配置', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: '未配置密钥请在设置中配置', timestamp: 1 })
    const hits = store.search('设置中')
    expect(hits.some((h) => h.sessionId === 's1' && h.messageId === 'u1')).toBe(true)
  })

  it('search matches session titles too', () => {
    store.insertSession({ id: 's1', title: '部署笔记', config: cfg, createdAt: 1, updatedAt: 1 })
    const hits = store.search('部署')
    expect(hits.some((h) => h.sessionId === 's1' && h.messageId === null)).toBe(true)
  })

  it('FTS content snippet wraps the match in sentinel delimiters', () => {
    store.insertSession({ id: 's1', title: '关于配置', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: '未配置密钥请在设置中配置', timestamp: 1 })
    const hit = store.search('设置中').find((h) => h.messageId === 'u1')
    expect(hit).toBeDefined()
    // U+0001 / U+0002 wrap the matched term; the legacy '[' / ']' must be gone.
    expect(hit!.snippet).toContain('\u0001')
    expect(hit!.snippet).toContain('\u0002')
    expect(hit!.snippet).not.toContain('[')
  })

  it('updateTitleIfAuto changes an auto title and reports the change count', () => {
    store.insertSession({ id: 's1', title: '新对话', config: cfg, createdAt: 1, updatedAt: 1 })
    expect(store.updateTitleIfAuto('s1', '截取标题')).toBe(1)
    expect(store.getSession('s1')!.title).toBe('截取标题')
  })

  it('updateTitleIfAuto is a no-op once a title is pinned', () => {
    store.insertSession({ id: 's1', title: '新对话', config: cfg, createdAt: 1, updatedAt: 1 })
    store.setCustomTitle('s1', '我的标题')
    expect(store.updateTitleIfAuto('s1', '自动标题')).toBe(0)
    expect(store.getSession('s1')!.title).toBe('我的标题')
  })

  it('updateConfig overwrites the stored config blob', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.updateConfig('s1', JSON.stringify({ llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd: '/proj' }))
    expect(JSON.parse(store.getSession('s1')!.config).cwd).toBe('/proj')
  })

  it('persists and loads the stopped flag on an assistant turn', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn({ id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'partial', timestamp: 2, stopped: true }, 's1', [])
    expect(store.loadMessages('s1').at(-1)).toMatchObject({ id: 'a1', role: 'assistant', content: 'partial', stopped: true })
  })

  it('omits stopped for a normal (non-cancelled) message', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    expect(store.loadMessages('s1')[0].stopped).toBeUndefined()
  })

  it('omits stopped for a normal assistant turn inserted via insertTurn', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn({ id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'ans', timestamp: 2 }, 's1', [])
    expect(store.loadMessages('s1').at(-1)!.stopped).toBeUndefined()
  })

  it('deleteLastAssistantMessage removes a trailing assistant turn and cascades agent_runs', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn(
      { id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'ans', timestamp: 2 },
      's1',
      [{ agentId: 'planner', role: 'planner', output: 'p', startedAt: 1, finishedAt: 2, seq: 0 }],
    )
    expect(store.deleteLastAssistantMessage('s1')).toBe(true)
    expect(store.loadMessages('s1').map((m) => m.id)).toEqual(['u1'])
    expect(store.loadAgentRuns('s1')).toHaveLength(0)
    expect(store.search('ans')).toHaveLength(0) // evicted from the FTS index too
  })

  it('deleteLastAssistantMessage is a no-op when the last message is a user message', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    expect(store.deleteLastAssistantMessage('s1')).toBe(false)
    expect(store.loadMessages('s1')).toHaveLength(1)
  })

  it('deleteLastAssistantMessage is a no-op on an empty session', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    expect(store.deleteLastAssistantMessage('s1')).toBe(false)
  })

  it('deleteSession cascades to messages, agent_runs, and FTS', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: '可搜索内容', timestamp: 1 })
    store.deleteSession('s1')
    expect(store.listSessions()).toHaveLength(0)
    expect(store.loadMessages('s1')).toHaveLength(0)
    expect(store.search('可搜索内容')).toHaveLength(0)
  })

  it('round-trips tool calls + delegation through insertTurn/loadAgentRuns', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn(
      { id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'done', timestamp: 3 },
      's1',
      [
        { agentId: 'supervisor', role: 'supervisor', output: 'done', startedAt: 1, finishedAt: 3, seq: 0, toolCalls: [] },
        {
          agentId: 'coder', role: 'coder', output: 'wrote it', startedAt: 1, finishedAt: 2, seq: 1,
          parentAgentId: 'supervisor', taskInput: 'implement the plan',
          toolCalls: [
            { callId: 'c1', agentId: 'coder', name: 'write_file', input: '{"path":"/a.ts"}', output: 'ok', status: 'finished', seq: 2 },
            { callId: 'c2', agentId: 'coder', name: 'read_file', input: '{"path":"/b.ts"}', status: 'error', error: 'ENOENT', seq: 3, truncated: true },
          ],
        },
      ],
    )
    const runs = store.loadAgentRuns('s1')
    const coder = runs.find((r) => r.agentId === 'coder')!
    expect(coder).toMatchObject({ taskInput: 'implement the plan', parentAgentId: 'supervisor' })
    expect(coder.toolCalls!.map((t) => [t.callId, t.name, t.status])).toEqual([
      ['c1', 'write_file', 'finished'],
      ['c2', 'read_file', 'error'],
    ])
    expect(coder.toolCalls![0]).toMatchObject({ output: 'ok' })
    expect(coder.toolCalls![1]).toMatchObject({ error: 'ENOENT', truncated: true })
    expect(runs.find((r) => r.agentId === 'supervisor')!.toolCalls).toEqual([])
  })

  it('deleteLastAssistantMessage cascades tool_calls', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn(
      { id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'done', timestamp: 3 },
      's1',
      [{ agentId: 'coder', role: 'coder', output: 'x', startedAt: 1, finishedAt: 2, seq: 0, toolCalls: [{ callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'finished', seq: 0 }] }],
    )
    expect(store.deleteLastAssistantMessage('s1')).toBe(true)
    expect(store.loadAgentRuns('s1')).toHaveLength(0)
    expect(store.countToolCalls('s1')).toBe(0)
  })

  it('deleteSession cascades tool_calls', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn(
      { id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'done', timestamp: 3 },
      's1',
      [{ agentId: 'coder', role: 'coder', output: 'x', startedAt: 1, finishedAt: 2, seq: 0, toolCalls: [{ callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'finished', seq: 0 }] }],
    )
    store.deleteSession('s1')
    expect(store.countToolCalls('s1')).toBe(0)
  })

  it('round-trips an assistant message timeline (reasoning + tool) and hydrates toolCalls in order', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn(
      {
        id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'done', timestamp: 3,
        timeline: [
          { kind: 'reasoning', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'let me think' },
          { kind: 'tool', stepSeq: 1, agentId: 'coder', role: 'coder', callId: 'c1' },
        ],
      },
      's1',
      [{
        agentId: 'coder', role: 'coder', output: 'wrote it', startedAt: 1, finishedAt: 2, seq: 1,
        toolCalls: [{ callId: 'c1', agentId: 'coder', name: 'write_file', input: '{"path":"/a.ts"}', output: 'ok', status: 'finished', seq: 1 }],
      }],
    )
    const msg = store.loadMessages('s1').find((m) => m.id === 'a1')!
    expect(msg.timeline).toEqual([
      { kind: 'reasoning', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'let me think' },
      { kind: 'tool', stepSeq: 1, agentId: 'coder', role: 'coder', callId: 'c1' },
    ])
    expect(msg.toolCalls!.map((t) => [t.callId, t.name, t.status])).toEqual([['c1', 'write_file', 'finished']])
    expect(msg.toolCalls![0]).toMatchObject({ output: 'ok', seq: 1 })
  })

  it('loads a legacy assistant turn (no timeline) with timeline and toolCalls undefined', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn({ id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'ans', timestamp: 2 }, 's1', [])
    const msg = store.loadMessages('s1').find((m) => m.id === 'a1')!
    expect(msg.timeline).toBeUndefined()
    expect(msg.toolCalls).toBeUndefined()
  })

  it('deleteSession still cascades a message that carries a timeline', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn(
      {
        id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'done', timestamp: 3,
        timeline: [{ kind: 'tool', stepSeq: 0, agentId: 'coder', role: 'coder', callId: 'c1' }],
      },
      's1',
      [{ agentId: 'coder', role: 'coder', output: 'x', startedAt: 1, finishedAt: 2, seq: 0, toolCalls: [{ callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'finished', seq: 0 }] }],
    )
    store.deleteSession('s1')
    expect(store.loadMessages('s1')).toHaveLength(0)
    expect(store.countToolCalls('s1')).toBe(0)
  })

  it('loadMessagesWithRuns attaches each turn\'s agent runs to its message by message_id', () => {
    const store2 = freshStore()
    store2.insertSession({ id: 's1', title: 'T', config: '{}', createdAt: 1, updatedAt: 1 })
    store2.insertTurn(
      { id: 'turn1', sessionId: 's1', agentId: 'supervisor', content: 'final answer', timestamp: 10 },
      's1',
      [
        { agentId: 'supervisor', role: 'supervisor', output: 'final answer', startedAt: 10, finishedAt: 20, seq: 0 },
        { agentId: 'planner-1', role: 'planner', output: 'the plan', startedAt: 11, finishedAt: 15, seq: 1, taskInput: 'make a plan', parentAgentId: 'supervisor' },
      ],
    )
    const msgs = store2.loadMessagesWithRuns('s1')
    expect(msgs).toHaveLength(1)
    const runs = msgs[0].agentRuns!
    expect(runs.map((r) => r.agentId)).toEqual(['supervisor', 'planner-1'])
    expect(runs[1]).toMatchObject({ taskInput: 'make a plan', parentAgentId: 'supervisor', output: 'the plan', messageId: 'turn1' })
  })
})
