/**
 * Integration matrix A1.1–A1.9
 * Cross-module paths only — unit details live in sibling *.test.ts files.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { MemoryFileConfig, Message } from '@hip/protocol'
import { MEMORY_FILE_CONFIG_DEFAULTS } from '@hip/protocol'
import { openDatabase } from '../persistence/open.js'
import { ContextInjectorRegistry } from '../session/context-injector.js'
import { ProjectAgentsMdInjector } from '../session/project-agents-md.js'
import { MemoryStore } from './store.js'
import { MemoryService } from './service.js'
import { MemoryInjector } from './inject.js'
import type { MemoryLlmClient } from './llm-client.js'
import * as llmClient from './llm-client.js'
import { runPhase1Extract } from './pipeline/phase1-extract.js'
import { runPhase2Consolidate } from './pipeline/phase2-consolidate.js'
import {
  maybeEnqueueMemoryExtract,
  resetPhase1Queue,
  scheduleMemoryExtractAfterTurn,
  processQueue,
} from './pipeline/queue.js'

function openMemDb(opts?: { vecEnabled?: boolean }) {
  const opened = openDatabase(':memory:')
  const vec =
    opts?.vecEnabled !== undefined ? opts.vecEnabled : opened.memoriesVecEnabled
  return {
    db: opened.db,
    store: new MemoryStore(opened.db, opened.memoriesFtsEnabled, vec),
    fts: opened.memoriesFtsEnabled,
    vec,
  }
}

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

describe('integration matrix A1.1–A1.9', () => {
  let configDir: string
  let configPath: string
  let store: MemoryStore
  let svc: MemoryService

  beforeEach(() => {
    resetPhase1Queue()
    configDir = mkdtempSync(join(tmpdir(), 'hip-mem-matrix-'))
    configPath = join(configDir, 'memory.json')
    ;({ store } = openMemDb())
    svc = new MemoryService(store, { configPath })
    svc.setConfig({ useMemories: true, generateMemories: true })
  })

  afterEach(() => {
    resetPhase1Queue()
    rmSync(configDir, { recursive: true, force: true })
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('A1.1: upsert project pinned item → loadCoreSnapshot(hash) includes title', () => {
    const title = 'Prefer yarn in this monorepo'
    svc.upsert({
      title,
      content: 'Always use yarn, never npm, for installs and scripts.',
      kind: 'preference',
      scope: 'project',
      projectKeyHash: 'pkh-matrix-1',
      projectKey: '/tmp/proj-matrix',
      pinned: true,
    })

    const snap = svc.loadCoreSnapshot('pkh-matrix-1')
    expect(snap.text).toContain(title)
    expect(snap.text).toMatch(/Memory \(core\)/i)
    expect(snap.text).toContain('### Pinned')
    expect(snap.ids.length).toBeGreaterThan(0)
  })

  it('A1.2: incognito skips Phase1 / enqueue and inject is empty when use forced false', async () => {
    expect(svc.resolveFlags({ generateMemories: true, useMemories: true, incognito: true })).toEqual({
      use: false,
      generate: false,
      incognito: true,
    })

    const llm: MemoryLlmClient = {
      completeJson: async () => ({
        raw_memory: '- should not write',
        rollout_summary: 'nope',
      }),
    }
    const sessionStore = { loadMessagesWithRuns: () => longTranscript() }

    const phase1 = await runPhase1Extract({
      store,
      sessionStore,
      sessionId: 'sess-incog',
      llm,
      config: cfg(),
      sessionConfig: { generateMemories: true, incognito: true },
    })
    expect(phase1).toEqual({ status: 'skipped', reason: 'incognito' })

    maybeEnqueueMemoryExtract({
      id: 'sess-incog',
      _config: { generateMemories: true, incognito: true },
      store: sessionStore,
      memoryService: svc,
    })
    const stage1Count = (
      store.getDb().prepare(`SELECT COUNT(*) AS n FROM memory_stage1`).get() as { n: number }
    ).n
    expect(stage1Count).toBe(0)

    // use forced false via incognito → MemoryInjector must not emit memory.
    const injector = new MemoryInjector(svc)
    const injectResult = await injector.inject({
      cwd: '/tmp/project',
      permissionMode: 'edit',
      skills: [],
      tokenBudgetPercent: 100,
      useMemories: false,
      memoryCoreSnapshot: '## Memory (core)\n### Pinned\n- secret tip',
    })
    expect(injectResult.systemMessages).toEqual([])
  })

  it('A1.3: Phase2 item sourceSessionId + deleteBySourceSession hard → getItem undefined', async () => {
    const now = Date.now()
    store.upsertStage1({
      id: 'st-a13',
      sessionId: 'sess-a13',
      projectKey: '/proj',
      projectKeyHash: 'pkh-a13',
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
      projectKeyHash: 'pkh-a13',
      projectKey: '/proj',
    })
    expect(res.status).toBe('succeeded')
    const items = store.listItems({ projectKeyHash: 'pkh-a13', status: 'active' })
    expect(items).toHaveLength(1)
    expect(items[0].sourceSessionId).toBe('sess-a13')
    const id = items[0].id

    const deleted = store.deleteBySourceSession('sess-a13')
    expect(deleted).toBe(1)
    expect(store.getItem(id)).toBeUndefined()
  })

  it('A1.4: ProjectAgentsMd before MemoryInjector header in joined system', async () => {
    writeFileSync(join(configDir, 'AGENTS.md'), 'Always use pnpm in this repo.\n')

    svc.upsert({
      title: 'Pinned yarn preference',
      content: 'Memory says yarn; AGENTS may override.',
      kind: 'preference',
      scope: 'global',
      pinned: true,
    })
    const snap = svc.loadCoreSnapshot(undefined)
    expect(snap.text).toContain('Pinned yarn preference')

    const registry = new ContextInjectorRegistry()
    registry.register(new ProjectAgentsMdInjector())
    registry.register(new MemoryInjector(svc))

    const results = await registry.injectAll({
      cwd: configDir,
      permissionMode: 'edit',
      skills: [],
      tokenBudgetPercent: 100,
      useMemories: true,
      memoryCoreSnapshot: snap.text,
      memoryCoreIds: snap.ids,
    })
    const system = results.flatMap((r) => r.systemMessages).join('\n\n')

    const agentsIdx = system.indexOf('Always use pnpm')
    const memoryHeaderIdx = system.indexOf('Cross-session memory')
    expect(agentsIdx).toBeGreaterThanOrEqual(0)
    expect(memoryHeaderIdx).toBeGreaterThan(agentsIdx)
    expect(system).toContain('AGENTS.md')
    expect(system).toMatch(/priority/i)
    expect(system).toContain('Pinned yarn preference')
  })

  it('A1.5: generate=false with long transcript → no stage1 row', async () => {
    svc.setConfig({ generateMemories: false })
    const llm: MemoryLlmClient = {
      completeJson: async () => ({
        raw_memory: '- must not persist',
        rollout_summary: 'nope',
      }),
    }

    const res = await runPhase1Extract({
      store,
      sessionStore: { loadMessagesWithRuns: () => longTranscript() },
      sessionId: 'sess-gen-off',
      llm,
      config: cfg({ generateMemories: false }),
      sessionConfig: { generateMemories: false },
    })
    expect(res).toEqual({ status: 'skipped', reason: 'generate_disabled' })

    const n = (
      store.getDb().prepare(`SELECT COUNT(*) AS n FROM memory_stage1`).get() as { n: number }
    ).n
    expect(n).toBe(0)
  })

  it('A1.6: two scheduleMemoryExtractAfterTurn within idle → single enqueue after idle', async () => {
    vi.useFakeTimers()
    svc.setConfig({ generateMemories: true, idleMinutes: 15, minExtractIntervalHours: 0 })

    let createClientCalls = 0
    const completeJson = vi.fn(async () => ({
      raw_memory: '- Prefer yarn',
      rollout_summary: 'prefs',
    }))
    vi.spyOn(llmClient, 'createDefaultMemoryLlmClient').mockImplementation(() => {
      createClientCalls += 1
      return { completeJson }
    })

    const host = {
      id: 'sess-debounce',
      _config: { generateMemories: true },
      store: { loadMessagesWithRuns: () => longTranscript() },
      memoryService: svc,
    }

    scheduleMemoryExtractAfterTurn(host)
    // Second turn within idle window resets debounce timer.
    scheduleMemoryExtractAfterTurn(host)

    await vi.advanceTimersByTimeAsync(14 * 60_000)
    expect(createClientCalls).toBe(0)

    await vi.advanceTimersByTimeAsync(2 * 60_000)
    // Drain auto-started processQueue.
    await processQueue()
    await Promise.resolve()

    expect(createClientCalls).toBe(1)
  })

  it('A1.7: soft delete → restore → active list', () => {
    const item = svc.upsert({
      id: 'trash-me',
      title: 'Soft-delete restore path',
      content: 'unique-matrix-trash-token-a17',
      kind: 'lesson',
      scope: 'global',
    })

    expect(svc.softDelete(item.id)).toBe(true)
    expect(svc.getItem(item.id)?.status).toBe('deleted')
    expect(store.listItems({ status: 'active' }).map((i) => i.id)).not.toContain(item.id)
    expect(store.listItems({ status: 'deleted' }).map((i) => i.id)).toContain(item.id)
    expect(svc.search('unique-matrix-trash-token-a17')).toHaveLength(0)

    const restored = svc.restore(item.id)
    expect(restored?.status).toBe('active')
    expect(store.listItems({ status: 'active' }).map((i) => i.id)).toContain(item.id)
    expect(svc.search('unique-matrix-trash-token-a17').map((i) => i.id)).toEqual([item.id])
  })

  it('A1.8: hybrid mock semantic query returns expected id', async () => {
    // Dedicated service with deterministic mock embeddings (no network).
    const opened = openMemDb()
    const hybridSvc = new MemoryService(opened.store, {
      configPath: join(configDir, 'memory-hybrid.json'),
      createEmbeddingClient: () => ({
        async embed(texts: string[]) {
          return texts.map((t) => {
            const s = t.trim()
            if (s === 'package management' || s.startsWith('package management')) {
              return [1, 0, 0]
            }
            if (s.includes('Yarn') || s.includes('yarn')) return [0.99, 0.01, 0]
            return [0, 1, 0]
          })
        },
      }),
    })
    hybridSvc.setConfig({
      embeddingModel: { providerID: 'openai', modelID: 'text-embedding-3-small' },
      hybridSearchEnabled: true,
    })

    const noise = hybridSvc.upsert({
      id: 'noise-a18',
      title: 'package package package noise',
      content: 'package management package package filler',
      kind: 'lesson',
      scope: 'global',
      confidence: 0.95,
    })
    const neighbor = hybridSvc.upsert({
      id: 'neighbor-a18',
      title: 'Yarn tip',
      content: 'package management prefers yarn',
      kind: 'lesson',
      scope: 'global',
      confidence: 0.4,
    })
    await hybridSvc.scheduleEmbed(noise.id)
    await hybridSvc.scheduleEmbed(neighbor.id)

    const hits = await hybridSvc.searchScoped('package management', { limit: 10 })
    expect(hits[0]?.id).toBe('neighbor-a18')

    const block = await hybridSvc.formatPrefetch('package management', undefined, undefined)
    expect(block.ids[0]).toBe('neighbor-a18')
    expect(block.text).toContain('Yarn tip')
  })

  it('A1.9: hybrid disabled / no embed / vec probe false → FTS still works', async () => {
    // Force vec disabled (as if sqlite-vec probe failed); BLOB path unused here.
    const opened = openMemDb({ vecEnabled: false })
    expect(opened.store.isVecEnabled()).toBe(false)
    const ftsSvc = new MemoryService(opened.store, {
      configPath: join(configDir, 'memory-fts-only.json'),
    })
    ftsSvc.setConfig({
      hybridSearchEnabled: false,
      // No embeddingModel — hybrid cannot engage.
    })
    expect(ftsSvc.getConfig().hybridSearchEnabled).toBe(false)
    expect(ftsSvc.getConfig().embeddingModel).toBeUndefined()
    expect(ftsSvc.getIndexStatus().vecEnabled).toBe(false)

    const item = ftsSvc.upsert({
      id: 'fts-a19',
      title: 'Yarn workspaces tip',
      content: 'Always use yarn for package management in monorepos',
      kind: 'preference',
      scope: 'global',
    })

    const fts = opened.store.searchInScopes('package management', { limit: 30 })
    expect(fts.map((x) => x.id)).toContain(item.id)

    const scoped = await ftsSvc.searchScoped('package management', { limit: 30 })
    expect(scoped.map((x) => x.id)).toEqual(fts.map((x) => x.id))
    expect(scoped.map((x) => x.id)).toContain(item.id)

    const block = await ftsSvc.formatPrefetch('package management', undefined, undefined)
    expect(block.text).toMatch(/Yarn workspaces tip|package management/i)
    expect(block.ids).toContain(item.id)
  })
})
