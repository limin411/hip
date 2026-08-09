/**
 * L1 process E2E: real file-backed hip.db + MemoryService/handlers, mock LLM/embed.
 * No network. Complements integration.matrix.test.ts (in-memory) and unit tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  ClientMessage,
  MemoryFileConfig,
  Message,
  ServerMessage,
  SessionConfig,
} from '@hip/protocol'
import { MEMORY_FILE_CONFIG_DEFAULTS } from '@hip/protocol'
import { openDatabase } from '../persistence/open.js'
import { MemoryStore } from './store.js'
import { MemoryService } from './service.js'
import { handleMemoryMessage, type MemoryHandlerContext } from './handlers.js'
import type { MemoryLlmClient } from './llm-client.js'
import * as llmClient from './llm-client.js'
import { runPhase1Extract } from './pipeline/phase1-extract.js'
import { runPhase2Consolidate } from './pipeline/phase2-consolidate.js'
import {
  scheduleMemoryExtractAfterTurn,
  processQueue,
  resetPhase1Queue,
  recordExtractSuccess,
  assertUnderDailyExtractLimit,
  maybeEnqueueMemoryExtract,
} from './pipeline/queue.js'
import { parseMemoryCitations } from './citations.js'
import type { Session } from '../session/session.js'

function cfg(partial: Partial<MemoryFileConfig> = {}): MemoryFileConfig {
  return {
    ...MEMORY_FILE_CONFIG_DEFAULTS,
    generateMemories: true,
    exportMarkdownMirror: false,
    ...partial,
  }
}

function longTranscript(): Message[] {
  return [
    {
      id: 'u1',
      role: 'user',
      content: 'We prefer TypeScript strict mode for this project and always use yarn.',
      timestamp: 1,
    },
    {
      id: 'a1',
      role: 'assistant',
      content: 'Understood, will use strict TypeScript and yarn.',
      agentId: 'supervisor',
      timestamp: 2,
    },
    {
      id: 'u2',
      role: 'user',
      content: 'Also pin important preferences so they show up in the core memory snapshot.',
      timestamp: 3,
    },
  ]
}

function fakeSession(initial: Partial<SessionConfig> = {}): Session {
  const base: SessionConfig = {
    llmProvider: 'deepseek',
    model: '',
    tools: [],
    ...initial,
  }
  const s = { _config: { ...base } } as Session & { _config: SessionConfig }
  Object.defineProperty(s, 'config', {
    get() {
      return this._config
    },
  })
  return s
}

function openFileMemDb(dir: string) {
  const dbPath = join(dir, 'hip.db')
  const opened = openDatabase(dbPath)
  return {
    dbPath,
    db: opened.db,
    store: new MemoryStore(opened.db, opened.memoriesFtsEnabled),
    fts: opened.memoriesFtsEnabled,
  }
}

describe('memory process e2e (file-backed hip.db)', () => {
  let dir: string
  let configPath: string
  let dbPath: string
  let store: MemoryStore
  let svc: MemoryService
  let sent: ServerMessage[]
  let sessions: Map<string, Session>
  let configBlobs: Map<string, string>
  let ctx: MemoryHandlerContext

  const send = (msg: ServerMessage) => {
    sent.push(msg)
  }

  beforeEach(() => {
    resetPhase1Queue()
    dir = mkdtempSync(join(tmpdir(), 'hip-mem-proc-'))
    configPath = join(dir, 'memory.json')
    process.env.HIP_MEMORY_CONFIG_PATH = configPath
    const opened = openFileMemDb(dir)
    dbPath = opened.dbPath
    store = opened.store
    svc = new MemoryService(store, { configPath })
    svc.setConfig({ useMemories: true, generateMemories: true })
    sent = []
    sessions = new Map()
    configBlobs = new Map()
    ctx = {
      getMemoryService: () => svc,
      ensureSession: (id) => {
        let s = sessions.get(id)
        if (!s) {
          const raw = configBlobs.get(id)
          const parsed = raw ? (JSON.parse(raw) as SessionConfig) : undefined
          s = fakeSession(parsed)
          sessions.set(id, s)
        }
        return s
      },
      getSession: (id) => sessions.get(id),
      store: {
        updateConfig(id, config) {
          configBlobs.set(id, config)
        },
        getSession(id) {
          const config = configBlobs.get(id)
          return config ? { config } : undefined
        },
      },
    }
  })

  afterEach(() => {
    resetPhase1Queue()
    delete process.env.HIP_MEMORY_CONFIG_PATH
    rmSync(dir, { recursive: true, force: true })
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('M1.1: setConfig persists memory.json on disk', () => {
    expect(existsSync(dbPath)).toBe(true)
    handleMemoryMessage(
      ctx,
      {
        type: 'memory:setConfig',
        config: {
          useMemories: true,
          generateMemories: true,
          idleMinutes: 0,
          minExtractIntervalHours: 0,
        },
      },
      send,
    )
    expect(sent[0]).toMatchObject({ type: 'memory:config' })
    expect(existsSync(configPath)).toBe(true)
    const disk = JSON.parse(readFileSync(configPath, 'utf8')) as MemoryFileConfig
    expect(disk.useMemories).toBe(true)
    expect(disk.generateMemories).toBe(true)
    expect(disk.idleMinutes).toBe(0)
    expect(disk.minExtractIntervalHours).toBe(0)
    handleMemoryMessage(ctx, { type: 'memory:getConfig' }, send)
    expect(sent[1]).toMatchObject({
      type: 'memory:config',
      config: expect.objectContaining({ idleMinutes: 0 }),
    })
  })

  it('M1.2: soft delete → list deleted → restore → active + FTS', () => {
    const item = svc.upsert({
      id: 'proc-trash-1',
      title: 'Soft-delete restore path',
      content: 'unique-process-e2e-trash-token-m12',
      kind: 'lesson',
      scope: 'global',
    })

    handleMemoryMessage(ctx, { type: 'memory:delete', id: item.id }, send)
    expect(sent[0]).toEqual({ type: 'memory:delete:result', id: item.id, ok: true })
    expect(svc.getItem(item.id)?.status).toBe('deleted')
    expect(svc.search('unique-process-e2e-trash-token-m12')).toHaveLength(0)

    handleMemoryMessage(ctx, { type: 'memory:list', status: 'deleted' }, send)
    expect(sent[1].type).toBe('memory:list:result')
    if (sent[1].type !== 'memory:list:result') throw new Error('expected list')
    expect(sent[1].items.map((i) => i.id)).toContain(item.id)

    handleMemoryMessage(ctx, { type: 'memory:restore', id: item.id }, send)
    expect(sent[2].type).toBe('memory:restore:result')
    if (sent[2].type !== 'memory:restore:result') throw new Error('expected restore')
    expect(sent[2].item?.status).toBe('active')
    expect(svc.search('unique-process-e2e-trash-token-m12').map((i) => i.id)).toEqual([item.id])
  })

  it('M1.3: emptyTrash hard-deletes soft-deleted items', () => {
    const a = svc.upsert({
      title: 'Trash A',
      content: 'process-e2e-empty-a',
      kind: 'lesson',
      scope: 'global',
    })
    const b = svc.upsert({
      title: 'Trash B',
      content: 'process-e2e-empty-b',
      kind: 'lesson',
      scope: 'global',
    })
    svc.softDelete(a.id)
    svc.softDelete(b.id)

    handleMemoryMessage(ctx, { type: 'memory:emptyTrash' }, send)
    expect(sent[0]).toEqual({ type: 'memory:emptyTrash:result', deleted: 2 })
    expect(svc.getItem(a.id)).toBeUndefined()
    expect(svc.getItem(b.id)).toBeUndefined()
    expect(store.listItems({ status: 'deleted' })).toHaveLength(0)
  })

  it('M1.4: session:setMemoryFlags persists via store.updateConfig', () => {
    handleMemoryMessage(
      ctx,
      {
        type: 'session:setMemoryFlags',
        sessionId: 'sess-flags',
        useMemories: true,
        generateMemories: false,
        incognito: true,
      },
      send,
    )
    expect(sent[0]).toMatchObject({
      type: 'session:memoryFlags',
      sessionId: 'sess-flags',
    })
    const raw = configBlobs.get('sess-flags')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as SessionConfig
    expect(parsed.useMemories).toBe(true)
    expect(parsed.generateMemories).toBe(false)
    expect(parsed.incognito).toBe(true)

    // Reload path: ensureSession reads blob
    sessions.delete('sess-flags')
    const reloaded = ctx.ensureSession('sess-flags', send)
    expect(reloaded.config.useMemories).toBe(true)
    expect(reloaded.config.incognito).toBe(true)
  })

  it('M1.5: pinned upsert → loadCoreSnapshot includes title (file db)', () => {
    const title = 'Prefer yarn in process e2e monorepo'
    handleMemoryMessage(
      ctx,
      {
        type: 'memory:upsert',
        item: {
          title,
          content: 'Always use yarn, never npm.',
          kind: 'preference',
          scope: 'global',
          pinned: true,
        },
      },
      send,
    )
    expect(sent[0].type).toBe('memory:upsert:result')
    const snap = svc.loadCoreSnapshot(undefined)
    expect(snap.text).toContain(title)
    expect(snap.text).toMatch(/Memory \(core\)/i)
    expect(snap.ids.length).toBeGreaterThan(0)
  })

  it('M1.6: Phase2 sourceSessionId + deleteBySourceSession hard', async () => {
    const now = Date.now()
    store.upsertStage1({
      id: 'st-proc-m16',
      sessionId: 'sess-proc-m16',
      projectKey: '/proj-proc',
      projectKeyHash: 'pkh-proc-m16',
      rawMemory: '- Prefer yarn over npm',
      rolloutSummary: 'Package manager preference',
      status: 'succeeded',
      sourceUpdatedAt: now,
      createdAt: now,
    })

    const llm: MemoryLlmClient = {
      completeJson: async () => ({
        items: [
          {
            action: 'upsert',
            title: 'Derived package tip',
            content: 'Use yarn not npm for this project',
            kind: 'lesson',
            scope: 'project',
            confidence: 0.6,
          },
        ],
        summary_md: 'Project prefers yarn.',
      }),
    }

    const res = await runPhase2Consolidate({
      store,
      llm,
      config: cfg(),
      projectKeyHash: 'pkh-proc-m16',
      projectKey: '/proj-proc',
    })
    expect(res.status).toBe('succeeded')
    const items = store.listItems({ projectKeyHash: 'pkh-proc-m16', status: 'active' })
    expect(items).toHaveLength(1)
    expect(items[0].sourceSessionId).toBe('sess-proc-m16')
    const id = items[0].id

    handleMemoryMessage(
      ctx,
      { type: 'memory:deleteBySourceSession', sessionId: 'sess-proc-m16' },
      send,
    )
    expect(sent[0]).toMatchObject({
      type: 'memory:deleteBySourceSession:result',
      deleted: 1,
    })
    expect(store.getItem(id)).toBeUndefined()
  })

  it('M1.7: Phase1 idle=0 + mock LLM writes stage1 on file db', async () => {
    vi.useFakeTimers()
    svc.setConfig({
      generateMemories: true,
      idleMinutes: 0,
      minExtractIntervalHours: 0,
    })

    let createClientCalls = 0
    vi.spyOn(llmClient, 'createDefaultMemoryLlmClient').mockImplementation(() => {
      createClientCalls += 1
      return {
        completeJson: async () => ({
          raw_memory: '- Prefer yarn (process-e2e-token-m17)',
          rollout_summary: 'prefs',
        }),
      }
    })

    const host = {
      id: 'sess-proc-m17',
      _config: { generateMemories: true },
      store: { loadMessagesWithRuns: () => longTranscript() },
      memoryService: svc,
    }

    scheduleMemoryExtractAfterTurn(host)
    expect(createClientCalls).toBe(0)
    await vi.advanceTimersByTimeAsync(0)
    await processQueue()
    await Promise.resolve()

    expect(createClientCalls).toBe(1)
    const n = (
      store.getDb().prepare(`SELECT COUNT(*) AS n FROM memory_stage1 WHERE session_id=?`).get(
        'sess-proc-m17',
      ) as { n: number }
    ).n
    expect(n).toBe(1)
  })

  it('M1.8: Phase2 consolidate from stage1 produces active items', async () => {
    const now = Date.now()
    store.upsertStage1({
      id: 'st-proc-m18',
      sessionId: 'sess-proc-m18',
      projectKey: '/proj',
      projectKeyHash: 'pkh-proc-m18',
      rawMemory: '- Always run yarn test before push',
      rolloutSummary: 'test discipline',
      status: 'succeeded',
      sourceUpdatedAt: now,
      createdAt: now,
    })

    const llm: MemoryLlmClient = {
      completeJson: async () => ({
        items: [
          {
            action: 'upsert',
            title: 'Test before push',
            content: 'Always run yarn test before push',
            kind: 'workflow',
            scope: 'project',
            confidence: 0.7,
          },
        ],
        summary_md: 'Test discipline.',
      }),
    }

    const res = await runPhase2Consolidate({
      store,
      llm,
      config: cfg(),
      projectKeyHash: 'pkh-proc-m18',
      projectKey: '/proj',
    })
    expect(res.status).toBe('succeeded')
    const items = store.listItems({ projectKeyHash: 'pkh-proc-m18', status: 'active' })
    expect(items.some((i) => i.title === 'Test before push')).toBe(true)
  })

  it('M1.9: maxExtractsPerDay blocks second extract', async () => {
    svc.setConfig({ generateMemories: true, maxExtractsPerDay: 1 })
    recordExtractSuccess()
    expect(assertUnderDailyExtractLimit(svc.getConfig())).toBe(false)

    const llmSpy = vi.spyOn(llmClient, 'createDefaultMemoryLlmClient').mockReturnValue({
      completeJson: async () => ({
        raw_memory: '- should not run',
        rollout_summary: 'nope',
      }),
    })

    maybeEnqueueMemoryExtract({
      id: 'sess-rate',
      _config: { generateMemories: true },
      store: { loadMessagesWithRuns: () => longTranscript() },
      memoryService: svc,
    })
    expect(llmSpy).not.toHaveBeenCalled()
  })

  it('M1.10: no embedding configured → FTS still works on file db', async () => {
    const item = svc.upsert({
      id: 'fts-m11',
      title: 'Yarn workspaces tip',
      content: 'Always use yarn for package management in monorepos',
      kind: 'preference',
      scope: 'global',
    })

    const scoped = await svc.searchScoped('package management', { limit: 30 })
    expect(scoped.map((x) => x.id)).toContain(item.id)

    const block = await svc.formatPrefetch('package management', undefined, undefined)
    expect(block.ids).toContain(item.id)
  })

  it('M1.12: citations fence parse strips content (process path unit)', () => {
    const content =
      'We should use yarn.\n\n```hip-memory-citations\n[{"memoryId":"mem-1","title":"Yarn tip"}]\n```\n'
    const { citations, strippedContent } = parseMemoryCitations(content, new Set(['mem-1']))
    expect(citations).toEqual([{ memoryId: 'mem-1', title: 'Yarn tip' }])
    expect(strippedContent).toBe('We should use yarn.')
    expect(strippedContent).not.toContain('hip-memory-citations')
  })

  it('M1.13: export jsonl → wipe soft path → import restores', () => {
    const item = svc.upsert({
      id: 'export-me',
      title: 'Export import token',
      content: 'process-e2e-export-import-unique',
      kind: 'preference',
      scope: 'global',
      pinned: true,
    })
    const jsonl = svc.exportJsonl({})
    expect(jsonl).toContain('process-e2e-export-import-unique')

    svc.hardDelete(item.id)
    expect(svc.getItem(item.id)).toBeUndefined()

    const { imported } = svc.importJsonl(jsonl, 'overwrite')
    expect(imported).toBeGreaterThanOrEqual(1)
    const restored = svc.getItem(item.id)
    expect(restored?.content).toContain('process-e2e-export-import-unique')
    expect(restored?.pinned).toBe(true)
  })

  it('M1.7b: runPhase1Extract directly succeeds on file db', async () => {
    const llm: MemoryLlmClient = {
      completeJson: async () => ({
        raw_memory: '- Prefer yarn process-e2e-direct',
        rollout_summary: 'prefs',
      }),
    }
    const res = await runPhase1Extract({
      store,
      sessionStore: { loadMessagesWithRuns: () => longTranscript() },
      sessionId: 'sess-direct-p1',
      llm,
      config: cfg({ generateMemories: true }),
      sessionConfig: { generateMemories: true },
    })
    expect(res.status).toBe('succeeded')
    expect(res.stage1Id).toBeTruthy()
  })
})
