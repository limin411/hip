import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from './open.js'
import { SessionStore } from './store.js'
import { scratchDirFor } from '../session/scratch.js'

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

  it('insertMessage persists attachments and loadMessages restores them', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    const attachments = [{ id: 'a1', name: 'pic.png', mimeType: 'image/png', size: 123 }]
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 7, attachments })
    expect(store.loadMessages('s1')[0]).toEqual({ id: 'u1', role: 'user', content: 'hi', agentId: undefined, timestamp: 7, attachments })
  })

  it('insertTurn persists memoryCitations and loadMessages restores them (no use_count side effects)', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    const cites = [{ memoryId: 'mem-1', title: 'Prefer yarn' }, { memoryId: 'mem-2' }]
    store.insertTurn(
      {
        id: 'a1',
        sessionId: 's1',
        agentId: 'supervisor',
        content: 'Use yarn for installs.',
        timestamp: 2,
        memoryCitations: cites,
      },
      's1',
      [],
    )
    const msg = store.loadMessages('s1').find((m) => m.id === 'a1')!
    expect(msg.content).toBe('Use yarn for installs.')
    expect(msg.memoryCitations).toEqual(cites)
    // Reload again — still present, still no side effects on memory tables.
    expect(store.loadMessages('s1').find((m) => m.id === 'a1')!.memoryCitations).toEqual(cites)
    expect(store.loadMessagesWithRuns('s1').find((m) => m.id === 'a1')!.memoryCitations).toEqual(cites)
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
    // Relies on FTS being active (ftsEnabled=true for the :memory: db). If this fails with no
    // sentinels in the snippet, FTS5/trigram is unavailable in this build (the LIKE fallback
    // emits a plain substr with no markers) — see fts-probe.test.ts.
    // U+0001 / U+0002 wrap the matched term; the legacy '[' / ']' delimiters must be gone.
    expect(hit!.snippet).toContain('\u0001')
    expect(hit!.snippet).toContain('\u0002')
    expect(hit!.snippet).not.toContain('[')
    expect(hit!.snippet).not.toContain(']')
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

  it('deleteSession purges event log and session_message for the aggregate (Sprint C privacy)', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    const db = store.getDb()
    db.prepare(
      `INSERT INTO event_sequence(aggregate_id, seq) VALUES(?, ?)`,
    ).run('s1', 1)
    db.prepare(
      `INSERT INTO event(id, aggregate_id, seq, type, data) VALUES(?,?,?,?,?)`,
    ).run('e1', 's1', 1, 'user_message', '{}')
    db.prepare(
      `INSERT INTO session_message(id, session_id, type, seq, time_created, time_updated, data) VALUES(?,?,?,?,?,?,?)`,
    ).run('sm1', 's1', 'user', 1, 1, 1, '{}')
    db.prepare(
      `INSERT INTO snapshots(session_id, seq, state, timestamp) VALUES(?,?,?,?)`,
    ).run('s1', 1, '{}', 1)
    store.deleteSession('s1')
    expect(db.prepare(`SELECT COUNT(*) AS n FROM event WHERE aggregate_id=?`).get('s1') as { n: number }).toEqual({ n: 0 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM event_sequence WHERE aggregate_id=?`).get('s1') as { n: number }).toEqual({ n: 0 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM session_message WHERE session_id=?`).get('s1') as { n: number }).toEqual({ n: 0 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM snapshots WHERE session_id=?`).get('s1') as { n: number }).toEqual({ n: 0 })
  })

  it('deleteSession keeps project-scoped memory, clears session-scoped, nulls source_session_id', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    const db = store.getDb()
    const now = 1
    db.prepare(`
      INSERT INTO memory_items(
        id, scope, session_id, kind, title, content, confidence, status, source,
        source_session_id, tags_json, created_at, updated_at, use_count, pinned
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run('sess-m', 'session', 's1', 'preference', 'session mem', 'c', 0.5, 'active', 'extract', 's1', '[]', now, now, 0, 0)
    db.prepare(`
      INSERT INTO memory_items(
        id, scope, session_id, kind, title, content, confidence, status, source,
        source_session_id, tags_json, created_at, updated_at, use_count, pinned
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run('proj-m', 'project', null, 'preference', 'project mem', 'c', 0.5, 'active', 'extract', 's1', '[]', now, now, 0, 0)
    db.prepare(`
      INSERT INTO memory_stage1(
        id, session_id, raw_memory, rollout_summary, status, selected_for_phase2,
        source_updated_at, created_at
      ) VALUES (?,?,?,?,?,?,?,?)
    `).run('st1', 's1', 'raw', 'sum', 'pending', 0, now, now)
    // Embeddings for session mem must drop; project mem embeddings stay.
    db.prepare(`
      INSERT INTO memory_embedding_rows(memory_id, model_key, dim, embedding, updated_at)
      VALUES (?,?,?,?,?)
    `).run('sess-m', 'm', 1, Buffer.alloc(4), now)
    db.prepare(`
      INSERT INTO memory_embedding_rows(memory_id, model_key, dim, embedding, updated_at)
      VALUES (?,?,?,?,?)
    `).run('proj-m', 'm', 1, Buffer.alloc(4), now)

    store.deleteSession('s1')

    expect(db.prepare(`SELECT COUNT(*) AS n FROM memory_items WHERE id='sess-m'`).get() as { n: number }).toEqual({ n: 0 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM memory_embedding_rows WHERE memory_id='sess-m'`).get() as { n: number }).toEqual({ n: 0 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM memory_embedding_rows WHERE memory_id='proj-m'`).get() as { n: number }).toEqual({ n: 1 })
    const proj = db.prepare(`SELECT source_session_id AS src FROM memory_items WHERE id='proj-m'`).get() as { src: string | null }
    expect(proj.src).toBeNull()
    expect(db.prepare(`SELECT COUNT(*) AS n FROM memory_stage1 WHERE session_id='s1'`).get() as { n: number }).toEqual({ n: 0 })
  })

  it('deleteSession with deleteDerivedMemories hard-deletes project items from that session', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    const db = store.getDb()
    const now = 1
    db.prepare(`
      INSERT INTO memory_items(
        id, scope, kind, title, content, confidence, status, source,
        source_session_id, tags_json, created_at, updated_at, use_count, pinned
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run('proj-m', 'project', 'preference', 'project mem', 'c', 0.5, 'active', 'extract', 's1', '[]', now, now, 0, 0)
    db.prepare(`
      INSERT INTO memory_items(
        id, scope, kind, title, content, confidence, status, source,
        source_session_id, tags_json, created_at, updated_at, use_count, pinned
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run('other-m', 'project', 'preference', 'other', 'c', 0.5, 'active', 'extract', 's2', '[]', now, now, 0, 0)
    db.prepare(`
      INSERT INTO memory_embedding_rows(memory_id, model_key, dim, embedding, updated_at)
      VALUES (?,?,?,?,?)
    `).run('proj-m', 'm', 1, Buffer.alloc(4), now)
    db.prepare(`
      INSERT INTO memory_embedding_rows(memory_id, model_key, dim, embedding, updated_at)
      VALUES (?,?,?,?,?)
    `).run('other-m', 'm', 1, Buffer.alloc(4), now)

    store.deleteSession('s1', { deleteDerivedMemories: true })

    expect(db.prepare(`SELECT COUNT(*) AS n FROM memory_items WHERE id='proj-m'`).get() as { n: number }).toEqual({ n: 0 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM memory_embedding_rows WHERE memory_id='proj-m'`).get() as { n: number }).toEqual({ n: 0 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM memory_items WHERE id='other-m'`).get() as { n: number }).toEqual({ n: 1 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM memory_embedding_rows WHERE memory_id='other-m'`).get() as { n: number }).toEqual({ n: 1 })
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
          parentAgentId: 'supervisor', taskInput: 'implement the plan', name: 'Coder',
          toolCalls: [
            { callId: 'c1', agentId: 'coder', name: 'write_file', input: '{"path":"/a.ts"}', output: 'ok', status: 'finished', seq: 2 },
            { callId: 'c2', agentId: 'coder', name: 'read_file', input: '{"path":"/b.ts"}', status: 'error', error: 'ENOENT', seq: 3, truncated: true },
          ],
        },
      ],
    )
    const runs = store.loadAgentRuns('s1')
    const coder = runs.find((r) => r.agentId === 'coder')!
    expect(coder).toMatchObject({ taskInput: 'implement the plan', parentAgentId: 'supervisor', name: 'Coder' })
    expect(coder.toolCalls!.map((t) => [t.callId, t.name, t.status])).toEqual([
      ['c1', 'write_file', 'finished'],
      ['c2', 'read_file', 'error'],
    ])
    expect(coder.toolCalls![0]).toMatchObject({ output: 'ok' })
    expect(coder.toolCalls![1]).toMatchObject({ error: 'ENOENT', truncated: true })
    expect(runs.find((r) => r.agentId === 'supervisor')!.toolCalls).toEqual([])
  })

  it('round-trips per-agent usage and reconstructs Message.usage = sum with max contextTokens', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn(
      { id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'done', timestamp: 3 },
      's1',
      [
        {
          agentId: 'supervisor',
          role: 'supervisor',
          output: 'done',
          startedAt: 1,
          finishedAt: 3,
          seq: 0,
          // multi-step sum 100 in, last-step context 70
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, contextTokens: 70 },
        },
        {
          agentId: 'worker-1',
          role: 'worker',
          output: 'sub',
          startedAt: 1,
          finishedAt: 2,
          seq: 1,
          parentAgentId: 'supervisor',
          taskInput: 'do',
          usage: { inputTokens: 30, outputTokens: 5, totalTokens: 35, contextTokens: 30 },
        },
      ],
    )
    const runs = store.loadAgentRuns('s1')
    expect(runs.find((r) => r.agentId === 'supervisor')!.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      contextTokens: 70,
    })
    expect(runs.find((r) => r.agentId === 'worker-1')!.usage).toEqual({
      inputTokens: 30,
      outputTokens: 5,
      totalTokens: 35,
      contextTokens: 30,
    })
    const msg = store.loadMessagesWithRuns('s1').find((m) => m.id === 'a1')!
    expect(msg.usage).toEqual({
      inputTokens: 130,
      outputTokens: 25,
      totalTokens: 155,
      contextTokens: 70, // max of agent peaks, not sum
    })
  })

  it('round-trips extended TurnUsage via usage_json (cache/modelId/incomplete)', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    const usage = {
      inputTokens: 1000,
      outputTokens: 50,
      totalTokens: 1050,
      contextTokens: 900,
      cacheReadTokens: 400,
      cacheWriteTokens: 100,
      nonCachedInputTokens: 500,
      reasoningTokens: 12,
      modelId: 'claude-sonnet-4',
      providerId: 'anthropic',
      incomplete: true,
    }
    store.insertTurn(
      { id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'done', timestamp: 2 },
      's1',
      [{ agentId: 'supervisor', role: 'supervisor', output: 'done', startedAt: 1, finishedAt: 2, seq: 0, usage }],
    )
    expect(store.loadAgentRuns('s1')[0].usage).toEqual(usage)
    expect(store.loadMessagesWithRuns('s1').find((m) => m.id === 'a1')!.usage).toEqual(usage)
  })

  it('loads legacy agent_runs rows (usage_json NULL) from token columns including contextTokens', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'a1', sessionId: 's1', role: 'assistant', agentId: 'supervisor', content: 'done', timestamp: 2 })
    store.getDb().prepare(
      `INSERT INTO agent_runs(session_id,message_id,seq,agent_id,role,output,started_at,finished_at,prompt_tokens,completion_tokens,total_tokens,context_tokens,usage_json)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('s1', 'a1', 0, 'supervisor', 'supervisor', 'done', 1, 2, 100, 20, 120, 70, null)
    expect(store.loadAgentRuns('s1')[0].usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      contextTokens: 70,
    })
    expect(store.loadMessagesWithRuns('s1').find((m) => m.id === 'a1')!.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      contextTokens: 70,
    })
  })

  it('falls back to token columns when usage_json is corrupt', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'a1', sessionId: 's1', role: 'assistant', agentId: 'supervisor', content: 'done', timestamp: 2 })
    store.getDb().prepare(
      `INSERT INTO agent_runs(session_id,message_id,seq,agent_id,role,output,started_at,finished_at,prompt_tokens,completion_tokens,total_tokens,context_tokens,usage_json)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('s1', 'a1', 0, 'supervisor', 'supervisor', 'done', 1, 2, 50, 10, 60, 40, 'not-json{')
    expect(store.loadAgentRuns('s1')[0].usage).toEqual({
      inputTokens: 50,
      outputTokens: 10,
      totalTokens: 60,
      contextTokens: 40,
    })
  })

  it('omits usage for a run inserted without it (legacy/no-usage rows stay NULL)', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn(
      { id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'done', timestamp: 2 },
      's1',
      [{ agentId: 'supervisor', role: 'supervisor', output: 'done', startedAt: 1, finishedAt: 2, seq: 0 }],
    )
    expect(store.loadAgentRuns('s1')[0].usage).toBeUndefined()
    expect(store.loadMessagesWithRuns('s1').find((m) => m.id === 'a1')!.usage).toBeUndefined()
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

  it('round-trips diff_base_sha (null by default)', () => {
    store.insertSession({ id: 'sd', title: 't', config: '{}', createdAt: 1, updatedAt: 1 })
    expect(store.getSession('sd')!.diff_base_sha).toBeNull()
    store.setDiffBaseSha('sd', 'deadbeef')
    expect(store.getSession('sd')!.diff_base_sha).toBe('deadbeef')
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

  it('inserts and lists checkpoints newest-first within a session', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertCheckpoint({ id: 's1:start', sessionId: 's1', turnId: null, kind: 'start', label: null, treeSha: 'tree0', commitSha: 'c0', branch: 'main', createdAt: 10 })
    store.insertCheckpoint({ id: 's1:t1', sessionId: 's1', turnId: 't1', kind: 'turn', label: 'add feature', treeSha: 'tree1', commitSha: 'c1', branch: 'main', createdAt: 20 })
    const list = store.listCheckpoints('s1')
    expect(list.map((c) => c.id)).toEqual(['s1:t1', 's1:start']) // newest-first
    expect(list[0]).toMatchObject({ turnId: 't1', kind: 'turn', label: 'add feature', treeSha: 'tree1', commitSha: 'c1', branch: 'main', createdAt: 20 })
    expect(list[1]).toMatchObject({ turnId: null, kind: 'start', label: null })
  })

  it('round-trips session git meta (branch + start commit, null by default)', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    expect(store.getSessionGitMeta('s1')).toEqual({ currentBranch: null, sessionStartCommit: null })
    store.setSessionBranch('s1', 'feature')
    store.setSessionStartCommit('s1', 'deadbeef')
    expect(store.getSessionGitMeta('s1')).toEqual({ currentBranch: 'feature', sessionStartCommit: 'deadbeef' })
  })

  describe('acp_session_id persistence', () => {
    it('stores and reads the acp session id', () => {
      store.insertSession({ id: 's1', title: 'title', config: JSON.stringify({ agentId: 'opencode' }), createdAt: 1, updatedAt: 1 })
      expect(store.getAcpSessionId('s1')).toBeNull()
      store.setAcpSessionId('s1', 'ses_abc')
      expect(store.getAcpSessionId('s1')).toBe('ses_abc')
    })

    it('clears acp_session_id to SQL NULL when set to null', () => {
      store.insertSession({ id: 's1', title: 'title', config: JSON.stringify({ agentId: 'opencode' }), createdAt: 1, updatedAt: 1 })
      store.setAcpSessionId('s1', 'ses_abc')
      expect(store.getAcpSessionId('s1')).toBe('ses_abc')
      store.setAcpSessionId('s1', null)
      expect(store.getAcpSessionId('s1')).toBeNull()
      const row = store.getDb().prepare('SELECT acp_session_id FROM sessions WHERE id=?').get('s1') as { acp_session_id: string | null }
      expect(row.acp_session_id).toBeNull()
    })
  })

  it('promoteSessionInputById is idempotent — second call does not overwrite promoted_seq', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.admitSessionInput({ id: 'in1', sessionId: 's1', prompt: 'hello', delivery: 'queue', timeCreated: 1 })
    store.promoteSessionInputById('s1', 'in1')
    const firstSeq = (store.getDb().prepare(`SELECT promoted_seq FROM session_input WHERE id=?`).get('in1') as { promoted_seq: number }).promoted_seq
    store.promoteSessionInputById('s1', 'in1')
    const secondSeq = (store.getDb().prepare(`SELECT promoted_seq FROM session_input WHERE id=?`).get('in1') as { promoted_seq: number }).promoted_seq
    expect(secondSeq).toBe(firstSeq)
  })
})

describe('SessionStore listSessions surface', () => {
  let store: SessionStore
  beforeEach(() => { store = freshStore() })

  it('returns the explicit surface from the stored config', () => {
    const codeCfg = JSON.stringify({ llmProvider: 'd', model: 'm', tools: [], surface: 'code', cwd: '/proj' })
    const chatCfg = JSON.stringify({ llmProvider: 'd', model: 'm', tools: [], surface: 'chat' })
    store.insertSession({ id: 'c', title: 't', config: codeCfg, createdAt: 1, updatedAt: 2 })
    store.insertSession({ id: 'h', title: 't', config: chatCfg, createdAt: 1, updatedAt: 1 })
    const list = store.listSessions()
    expect(list.find((s) => s.id === 'c')!.surface).toBe('code')
    expect(list.find((s) => s.id === 'c')!.cwd).toBe('/proj')
    expect(list.find((s) => s.id === 'h')!.surface).toBe('chat')
    expect(list.find((s) => s.id === 'h')!.cwd).toBeUndefined()
  })

  it('infers a legacy session: scratch cwd ⇒ chat, real cwd ⇒ code', () => {
    const legacyChat = JSON.stringify({ llmProvider: 'd', model: 'm', tools: [], cwd: scratchDirFor('lc') })
    const legacyCode = JSON.stringify({ llmProvider: 'd', model: 'm', tools: [], cwd: '/Users/me/proj' })
    store.insertSession({ id: 'lc', title: 't', config: legacyChat, createdAt: 1, updatedAt: 2 })
    store.insertSession({ id: 'ld', title: 't', config: legacyCode, createdAt: 1, updatedAt: 1 })
    const list = store.listSessions()
    expect(list.find((s) => s.id === 'lc')!.surface).toBe('chat')
    expect(list.find((s) => s.id === 'ld')!.surface).toBe('code')
  })

  it('returns terminal surface for managed-terminal conversations', () => {
    const terminalCfg = JSON.stringify({
      llmProvider: 'd',
      model: 'm',
      tools: [],
      surface: 'terminal',
      managedTerminalId: 'tm_1',
      hostId: 'hst_1',
      remotePathHint: '/var/www',
    })
    store.insertSession({ id: 't1', title: 't', config: terminalCfg, createdAt: 1, updatedAt: 1 })
    const list = store.listSessions()
    expect(list.find((s) => s.id === 't1')!.surface).toBe('terminal')
  })
})

describe('SessionStore soft-delete / trash', () => {
  let store: SessionStore
  beforeEach(() => { store = freshStore() })

  it('softDelete hides from listSessions and search but keeps messages', () => {
    store.insertSession({ id: 's1', title: '可搜索标题', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'm1', sessionId: 's1', role: 'user', agentId: null, content: '可搜索内容', timestamp: 2 })

    expect(store.softDeleteSession('s1', { deletedAt: 1000 })).toBe(true)
    expect(store.isSessionTrashed('s1')).toBe(true)
    expect(store.getActiveSession('s1')).toBeUndefined()
    expect(store.listSessions()).toHaveLength(0)
    expect(store.search('可搜索内容')).toHaveLength(0)
    expect(store.search('可搜索标题')).toHaveLength(0)
    expect(store.loadMessages('s1')).toHaveLength(1)
    expect(store.getSession('s1')?.deleted_at).toBe(1000)
  })

  it('listTrashedSessions returns trash rows newest-first', () => {
    store.insertSession({ id: 'a', title: 'a', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertSession({ id: 'b', title: 'b', config: cfg, createdAt: 1, updatedAt: 2 })
    store.softDeleteSession('a', { deletedAt: 10 })
    store.softDeleteSession('b', { deletedAt: 20, deleteDerivedMemories: true })
    const trash = store.listTrashedSessions()
    expect(trash.map((t) => t.id)).toEqual(['b', 'a'])
    expect(trash[0]).toMatchObject({ id: 'b', deletedAt: 20, deleteDerivedMemories: true })
    expect(trash[1]).toMatchObject({ id: 'a', deletedAt: 10, deleteDerivedMemories: false })
  })

  it('restoreSession clears deleted_at and returns to active list with messages', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'm1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 2 })
    store.softDeleteSession('s1', { deletedAt: 50 })
    expect(store.restoreSession('s1', { restoredAt: 60 })).toBe(true)
    expect(store.isSessionTrashed('s1')).toBe(false)
    expect(store.listSessions()).toHaveLength(1)
    expect(store.loadMessages('s1')).toHaveLength(1)
    expect(store.listTrashedSessions()).toHaveLength(0)
    expect(store.restoreSession('s1')).toBe(false)
  })

  it('softDelete soft-deletes session-scoped memory and stage1; optional derived soft', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    const db = store.getDb()
    const now = 1
    db.prepare(`
      INSERT INTO memory_items(
        id, scope, session_id, kind, title, content, confidence, status, source,
        source_session_id, tags_json, created_at, updated_at, use_count, pinned
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run('sess-m', 'session', 's1', 'preference', 'session mem', 'c', 0.5, 'active', 'extract', 's1', '[]', now, now, 0, 0)
    db.prepare(`
      INSERT INTO memory_items(
        id, scope, session_id, kind, title, content, confidence, status, source,
        source_session_id, tags_json, created_at, updated_at, use_count, pinned
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run('proj-m', 'project', null, 'preference', 'project mem', 'c', 0.5, 'active', 'extract', 's1', '[]', now, now, 0, 0)
    db.prepare(`
      INSERT INTO memory_stage1(
        id, session_id, raw_memory, rollout_summary, status, selected_for_phase2,
        source_updated_at, created_at
      ) VALUES (?,?,?,?,?,?,?,?)
    `).run('st1', 's1', 'raw', 'sum', 'pending', 0, now, now)

    store.softDeleteSession('s1', { deletedAt: 100, deleteDerivedMemories: true })

    expect(db.prepare(`SELECT status FROM memory_items WHERE id='sess-m'`).get() as { status: string }).toEqual({ status: 'deleted' })
    expect(db.prepare(`SELECT status FROM memory_items WHERE id='proj-m'`).get() as { status: string }).toEqual({ status: 'deleted' })
    expect(db.prepare(`SELECT source_session_id AS src FROM memory_items WHERE id='proj-m'`).get() as { src: string }).toEqual({ src: 's1' })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM memory_stage1 WHERE session_id='s1'`).get() as { n: number }).toEqual({ n: 0 })
  })

  it('restoreSession reactivates session-scoped memory but not derived soft-deleted items', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    const db = store.getDb()
    const now = 1
    db.prepare(`
      INSERT INTO memory_items(
        id, scope, session_id, kind, title, content, confidence, status, source,
        source_session_id, tags_json, created_at, updated_at, use_count, pinned
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run('sess-m', 'session', 's1', 'preference', 'session mem', 'c', 0.5, 'active', 'extract', null, '[]', now, now, 0, 0)
    db.prepare(`
      INSERT INTO memory_items(
        id, scope, session_id, kind, title, content, confidence, status, source,
        source_session_id, tags_json, created_at, updated_at, use_count, pinned
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run('proj-m', 'project', null, 'preference', 'project mem', 'c', 0.5, 'active', 'extract', 's1', '[]', now, now, 0, 0)

    store.softDeleteSession('s1', { deletedAt: 100, deleteDerivedMemories: true })
    store.restoreSession('s1', { restoredAt: 200 })

    expect(db.prepare(`SELECT status FROM memory_items WHERE id='sess-m'`).get() as { status: string }).toEqual({ status: 'active' })
    expect(db.prepare(`SELECT status FROM memory_items WHERE id='proj-m'`).get() as { status: string }).toEqual({ status: 'deleted' })
  })

  it('hard delete after soft uses stored delete_derived_memories when opts omitted', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    const db = store.getDb()
    const now = 1
    db.prepare(`
      INSERT INTO memory_items(
        id, scope, kind, title, content, confidence, status, source,
        source_session_id, tags_json, created_at, updated_at, use_count, pinned
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run('proj-m', 'project', 'preference', 'project mem', 'c', 0.5, 'active', 'extract', 's1', '[]', now, now, 0, 0)

    store.softDeleteSession('s1', { deletedAt: 100, deleteDerivedMemories: true })
    store.deleteSession('s1') // honor stored flag

    expect(db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE id='s1'`).get() as { n: number }).toEqual({ n: 0 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM memory_items WHERE id='proj-m'`).get() as { n: number }).toEqual({ n: 0 })
  })

  it('purgeTrashedOlderThan hard-deletes only expired trash rows', () => {
    store.insertSession({ id: 'old', title: 'old', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertSession({ id: 'new', title: 'new', config: cfg, createdAt: 1, updatedAt: 2 })
    store.insertMessage({ id: 'm-old', sessionId: 'old', role: 'user', agentId: null, content: 'old body', timestamp: 1 })
    store.insertMessage({ id: 'm-new', sessionId: 'new', role: 'user', agentId: null, content: 'new body', timestamp: 2 })
    store.softDeleteSession('old', { deletedAt: 1000 })
    store.softDeleteSession('new', { deletedAt: 5000 })

    const purged = store.purgeTrashedOlderThan(3000)
    expect(purged).toEqual(['old'])
    expect(store.getSession('old')).toBeUndefined()
    expect(store.loadMessages('old')).toHaveLength(0)
    expect(store.isSessionTrashed('new')).toBe(true)
    expect(store.loadMessages('new')).toHaveLength(1)
  })

  it('purgeTrashedByRetentionDays uses parameterized retention (not hardcoded)', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    const now = 10 * 24 * 60 * 60 * 1000 // day 10
    store.softDeleteSession('s1', { deletedAt: now - 8 * 24 * 60 * 60 * 1000 }) // 8 days ago
    expect(store.purgeTrashedByRetentionDays(7, now)).toEqual(['s1'])

    store.insertSession({ id: 's2', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.softDeleteSession('s2', { deletedAt: now - 3 * 24 * 60 * 60 * 1000 }) // 3 days ago
    expect(store.purgeTrashedByRetentionDays(7, now)).toEqual([])
    expect(store.isSessionTrashed('s2')).toBe(true)
  })

  it('softDelete is idempotent and missing id returns false', () => {
    expect(store.softDeleteSession('missing')).toBe(false)
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    expect(store.softDeleteSession('s1', { deletedAt: 1 })).toBe(true)
    expect(store.softDeleteSession('s1', { deletedAt: 2 })).toBe(true)
    expect(store.getSession('s1')?.deleted_at).toBe(1) // write-once until restore
  })
})
