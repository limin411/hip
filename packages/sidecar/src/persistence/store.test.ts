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

  it('deleteSession cascades to messages, agent_runs, and FTS', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: '可搜索内容', timestamp: 1 })
    store.deleteSession('s1')
    expect(store.listSessions()).toHaveLength(0)
    expect(store.loadMessages('s1')).toHaveLength(0)
    expect(store.search('可搜索内容')).toHaveLength(0)
  })
})
