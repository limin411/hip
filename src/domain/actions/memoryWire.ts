// src/domain/actions/memoryWire.ts
// Wire actions for cross-session memory + provider probing, extracted from
// SessionService (P2, spec docs/design/2026-08-07-session-service-decomposition-spec.md).
// Holds no state: transport + waiter are injected by the session facade.
import type {
  EmptyGreetingGenerateContext,
  KeyProbeCode,
  MemoryFileConfig,
  MemoryItem,
  MemoryScope,
  MemoryStatus,
} from '@hip/protocol'
import { nanoid } from 'nanoid'
import type { MessageWaiter } from '../messageWaiter'
import type { Transport } from '../transport'
import { useDomainStore } from '../sessionStore'

export type TestProviderRequest = {
  purpose: 'chat' | 'embedding' | 'rerank'
  providerID: string
  baseURL?: string
  modelID?: string
  apiKey?: string
}

export type TestProviderResult = {
  ok: boolean
  code: KeyProbeCode
  message: string
  latencyMs?: number
  checkedAt: number
  cached?: boolean
}

export type {
  EmptyGreetingGenerateContext,
  MemoryFileConfig,
  MemoryItem,
  MemoryScope,
  MemoryStatus,
} from '@hip/protocol'

export class MemoryWire {
  constructor(
    private readonly transport: Transport,
    private readonly waiter: MessageWaiter,
  ) {}

  async testProvider(req: TestProviderRequest, timeoutMs = 20_000): Promise<TestProviderResult> {
    const requestId = nanoid()
    const wait = this.waiter.waitWhere(
      'config:testProvider:result',
      (m) => m.requestId === requestId,
      timeoutMs,
    )
    this.transport.send({
      type: 'config:testProvider',
      requestId,
      purpose: req.purpose,
      providerID: req.providerID,
      ...(req.baseURL !== undefined ? { baseURL: req.baseURL } : {}),
      ...(req.modelID !== undefined ? { modelID: req.modelID } : {}),
      ...(req.apiKey !== undefined ? { apiKey: req.apiKey } : {}),
    })
    const msg = await wait
    return {
      ok: msg.ok,
      code: msg.code,
      message: msg.message,
      latencyMs: msg.latencyMs,
      checkedAt: msg.checkedAt,
      cached: msg.cached,
    }
  }

  async getMemoryConfig(): Promise<MemoryFileConfig> {
    const wait = this.waiter.wait('memory:config')
    this.transport.send({ type: 'memory:getConfig' })
    const msg = await wait
    return msg.config
  }

  async setMemoryConfig(config: Partial<MemoryFileConfig>): Promise<MemoryFileConfig> {
    // setConfig validation failures arrive as type:error (code MEMORY_CONFIG).
    const wait = this.waiter.waitFirst(['memory:config', 'error'])
    this.transport.send({ type: 'memory:setConfig', config })
    const msg = await wait
    if (msg.type === 'error') {
      throw new Error(msg.message)
    }
    return msg.config
  }

  async getMemoryIndexStatus(): Promise<{
    embedded: number
    total: number
    modelKey?: string
    vecEnabled?: boolean
  }> {
    const wait = this.waiter.wait('memory:indexStatus:result')
    this.transport.send({ type: 'memory:indexStatus' })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return {
      embedded: msg.embedded,
      total: msg.total,
      modelKey: msg.modelKey,
      vecEnabled: msg.vecEnabled,
    }
  }

  async reindexMemories(): Promise<{
    embedded: number
    total: number
    failed: number
    modelKey?: string
  }> {
    const wait = this.waiter.wait('memory:reindex:result')
    this.transport.send({ type: 'memory:reindex' })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return {
      embedded: msg.embedded,
      total: msg.total,
      failed: msg.failed ?? 0,
      modelKey: msg.modelKey,
    }
  }

  async listMemories(filter?: {
    scope?: MemoryScope
    projectKeyHash?: string
    sessionId?: string
    query?: string
    limit?: number
    status?: MemoryStatus
  }): Promise<MemoryItem[]> {
    const wait = this.waiter.wait('memory:list:result')
    this.transport.send({ type: 'memory:list', ...filter })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return msg.items
  }

  async upsertMemory(
    item: Partial<MemoryItem> & Pick<MemoryItem, 'title' | 'content' | 'kind' | 'scope'>,
  ): Promise<MemoryItem> {
    const wait = this.waiter.wait('memory:upsert:result')
    this.transport.send({ type: 'memory:upsert', item })
    const msg = await wait
    if (msg.error || !msg.item) throw new Error(msg.error ?? 'upsert failed')
    return msg.item
  }

  async deleteMemory(id: string, hard?: boolean): Promise<boolean> {
    const wait = this.waiter.wait('memory:delete:result')
    this.transport.send({ type: 'memory:delete', id, ...(hard !== undefined ? { hard } : {}) })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return msg.ok
  }

  async deleteMemoriesBySourceSession(sessionId: string, soft?: boolean): Promise<number> {
    const wait = this.waiter.wait('memory:deleteBySourceSession:result')
    this.transport.send({
      type: 'memory:deleteBySourceSession',
      sessionId,
      ...(soft !== undefined ? { soft } : {}),
    })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return msg.deleted
  }

  async restoreMemory(id: string): Promise<MemoryItem> {
    const wait = this.waiter.wait('memory:restore:result')
    this.transport.send({ type: 'memory:restore', id })
    const msg = await wait
    if (msg.error || !msg.item) throw new Error(msg.error ?? 'restore failed')
    return msg.item
  }

  async emptyMemoryTrash(): Promise<number> {
    const wait = this.waiter.wait('memory:emptyTrash:result')
    this.transport.send({ type: 'memory:emptyTrash' })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return msg.deleted
  }

  async exportMemories(format: 'jsonl' | 'markdown' = 'jsonl'): Promise<string> {
    const wait = this.waiter.wait('memory:export:result')
    this.transport.send({ type: 'memory:export', format })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return msg.data
  }

  async importMemories(data: string): Promise<number> {
    const wait = this.waiter.wait('memory:import:result')
    this.transport.send({ type: 'memory:import', format: 'jsonl', data })
    const msg = await wait
    if (msg.error || !msg.ok) throw new Error(msg.error ?? 'import failed')
    return msg.imported
  }

  /**
   * Run Phase2 consolidate and wait for the terminal `memory:pipeline` event
   * (succeeded | failed | noop). Phase "started" is ignored.
   */
  async consolidateMemories(projectKeyHash?: string): Promise<{
    status: 'succeeded' | 'failed' | 'noop'
    detail?: string
  }> {
    const wait = this.waiter.waitWhere(
      'memory:pipeline',
      (msg) =>
        msg.phase === 2 &&
        (msg.status === 'succeeded' || msg.status === 'failed' || msg.status === 'noop'),
      180_000,
    )
    this.transport.send({
      type: 'memory:consolidate',
      ...(projectKeyHash ? { projectKeyHash } : {}),
    })
    const msg = await wait
    return {
      status: msg.status as 'succeeded' | 'failed' | 'noop',
      detail: msg.detail,
    }
  }

  async getMemoryStatus(opts?: {
    projectKeyHash?: string
    contextWindowTokens?: number
  }): Promise<import('@hip/protocol').MemoryPipelineStatus> {
    const wait = this.waiter.wait('memory:status')
    this.transport.send({
      type: 'memory:getStatus',
      ...(opts?.projectKeyHash ? { projectKeyHash: opts.projectKeyHash } : {}),
      ...(opts?.contextWindowTokens !== undefined
        ? { contextWindowTokens: opts.contextWindowTokens }
        : {}),
    })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return msg.status
  }

  async rewriteMemoryMirrors(projectKeyHash?: string): Promise<string[]> {
    const wait = this.waiter.wait('memory:rewriteMirrors:result')
    this.transport.send({
      type: 'memory:rewriteMirrors',
      ...(projectKeyHash ? { projectKeyHash } : {}),
    })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return msg.written
  }

  async importMemoryMirror(opts?: {
    projectKeyHash?: string
    conflict?: 'keep' | 'overwrite'
  }): Promise<{ imported: number; skipped: number }> {
    const wait = this.waiter.wait('memory:importMirror:result')
    this.transport.send({
      type: 'memory:importMirror',
      ...(opts?.projectKeyHash ? { projectKeyHash: opts.projectKeyHash } : {}),
      ...(opts?.conflict ? { conflict: opts.conflict } : {}),
    })
    const msg = await wait
    if (msg.error) throw new Error(msg.error)
    return { imported: msg.imported, skipped: msg.skipped }
  }

  /** Send a raw client message (TaskRuntime control plane). */
  sendClient(msg: import('@hip/protocol').ClientMessage): void {
    this.transport.send(msg)
  }

  listRuntimeTasks(sessionId: string): void {
    this.transport.send({ type: 'task:list', sessionId })
  }

  stopRuntimeTask(sessionId: string, taskId: string, reason?: string): void {
    this.transport.send({ type: 'task:stop', sessionId, taskId, ...(reason ? { reason } : {}) })
  }

  setMemoryFlags(
    sessionId: string,
    flags: { useMemories?: boolean; generateMemories?: boolean; incognito?: boolean },
  ): void {
    // Optimistic local merge; server echoes session:memoryFlags.
    useDomainStore.getState().apply({
      type: 'session:memoryFlags',
      sessionId,
      ...flags,
    })
    this.transport.send({ type: 'session:setMemoryFlags', sessionId, ...flags })
  }

  /**
   * One-shot empty-state greeting via built-in model path (no ACP/tools/session).
   * Uses last-used model when provided. Always-on product path; caller keeps rule-based fallback.
   */
  async generateEmptyGreeting(opts: {
    requestId?: string
    providerID?: string
    modelID?: string
    context: EmptyGreetingGenerateContext
    timeoutMs?: number
  }): Promise<{ ok: true; title: string; sub: string } | { ok: false; error: string }> {
    const requestId = opts.requestId ?? nanoid()
    const timeoutMs = opts.timeoutMs ?? 4_000
    const wait = this.waiter.waitWhere(
      'ui:emptyGreeting:generate:result',
      (msg) => msg.requestId === requestId,
      timeoutMs,
    )
    this.transport.send({
      type: 'ui:emptyGreeting:generate',
      requestId,
      ...(opts.providerID ? { providerID: opts.providerID } : {}),
      ...(opts.modelID ? { modelID: opts.modelID } : {}),
      context: opts.context,
    })
    try {
      const msg = await wait
      if (!msg.ok || !msg.title || !msg.sub) {
        return { ok: false, error: msg.error ?? 'empty greeting generation failed' }
      }
      return { ok: true, title: msg.title, sub: msg.sub }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message || 'timeout' }
    }
  }
}
