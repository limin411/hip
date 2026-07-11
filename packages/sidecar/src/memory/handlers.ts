import type { ClientMessage, MemoryItem, SessionConfig } from '@hip/protocol'
import type { Session } from '../session/session.js'
import type { SendFn } from '../session/handlers/types.js'
import type { MemoryService } from './service.js'
import { createDefaultMemoryLlmClient } from './llm-client.js'
import { runPhase2Consolidate } from './pipeline/phase2-consolidate.js'
import { runDecayJob } from './pipeline/evolution.js'

export const MEMORY_MESSAGE_TYPES = new Set([
  'memory:list',
  'memory:get',
  'memory:upsert',
  'memory:delete',
  'memory:deleteBySourceSession',
  'memory:export',
  'memory:import',
  'memory:getConfig',
  'memory:setConfig',
  'memory:consolidate',
  'session:setMemoryFlags',
])

export function isMemoryMessage(msg: ClientMessage): boolean {
  return MEMORY_MESSAGE_TYPES.has(msg.type)
}

export type MemoryHandlerContext = {
  getMemoryService(): MemoryService
  ensureSession(id: string, send: SendFn): Session
  getSession(id: string): Session | undefined
  store?: {
    updateConfig(id: string, config: string): void
    getSession?(id: string): { config: string } | undefined
  } | null
}

function itemsToMarkdown(items: MemoryItem[]): string {
  if (items.length === 0) return ''
  return (
    items
      .map((it) => {
        const meta = [
          `id: ${it.id}`,
          `scope: ${it.scope}`,
          `kind: ${it.kind}`,
          `status: ${it.status}`,
        ].join(' | ')
        return `## ${it.title}\n\n<!-- ${meta} -->\n\n${it.content}`
      })
      .join('\n\n---\n\n') + '\n'
  )
}

/**
 * Memory WS handlers. Caller must gate with isMemoryMessage.
 * Sync — no awaits; errors are sent as result payloads.
 */
export function handleMemoryMessage(
  ctx: MemoryHandlerContext,
  msg: ClientMessage,
  send: SendFn,
): void {
  switch (msg.type) {
    case 'memory:list': {
      try {
        const svc = ctx.getMemoryService()
        const query = msg.query?.trim()
        const items = query
          ? svc.search(query, {
              projectKeyHash: msg.projectKeyHash,
              sessionId: msg.sessionId,
              limit: msg.limit,
            })
          : svc.store.listItems({
              scope: msg.scope,
              projectKeyHash: msg.projectKeyHash,
              sessionId: msg.sessionId,
              limit: msg.limit,
              // Default: active only (archived/deleted stay out of the browser).
              status: msg.status ?? 'active',
            })
        send({ type: 'memory:list:result', items })
      } catch (e) {
        send({ type: 'memory:list:result', items: [], error: String(e) })
      }
      return
    }
    case 'memory:get': {
      try {
        const item = ctx.getMemoryService().getItem(msg.id)
        send({ type: 'memory:get:result', item })
      } catch (e) {
        send({ type: 'memory:get:result', error: String(e) })
      }
      return
    }
    case 'memory:upsert': {
      try {
        const item = ctx.getMemoryService().upsert(msg.item)
        send({ type: 'memory:upsert:result', item })
      } catch (e) {
        send({ type: 'memory:upsert:result', error: String(e) })
      }
      return
    }
    case 'memory:delete': {
      try {
        const svc = ctx.getMemoryService()
        const ok = msg.hard ? svc.hardDelete(msg.id) : svc.softDelete(msg.id)
        send({ type: 'memory:delete:result', id: msg.id, ok })
      } catch (e) {
        send({ type: 'memory:delete:result', id: msg.id, ok: false, error: String(e) })
      }
      return
    }
    case 'memory:deleteBySourceSession': {
      try {
        const deleted = ctx
          .getMemoryService()
          .store.deleteBySourceSession(msg.sessionId, { soft: msg.soft })
        send({
          type: 'memory:deleteBySourceSession:result',
          sessionId: msg.sessionId,
          deleted,
        })
      } catch (e) {
        send({
          type: 'memory:deleteBySourceSession:result',
          sessionId: msg.sessionId,
          deleted: 0,
          error: String(e),
        })
      }
      return
    }
    case 'memory:export': {
      try {
        const svc = ctx.getMemoryService()
        const filter = {
          scope: msg.scope,
          projectKeyHash: msg.projectKeyHash,
        }
        if (msg.format === 'markdown') {
          const items = svc.store.listItems({ ...filter, limit: 10_000 })
          send({
            type: 'memory:export:result',
            format: 'markdown',
            data: itemsToMarkdown(items),
          })
        } else {
          send({
            type: 'memory:export:result',
            format: 'jsonl',
            data: svc.exportJsonl(filter),
          })
        }
      } catch (e) {
        send({
          type: 'memory:export:result',
          format: msg.format,
          data: '',
          error: String(e),
        })
      }
      return
    }
    case 'memory:import': {
      try {
        const { imported } = ctx.getMemoryService().importJsonl(msg.data, msg.conflict ?? 'keep')
        send({ type: 'memory:import:result', ok: true, imported })
      } catch (e) {
        send({
          type: 'memory:import:result',
          ok: false,
          imported: 0,
          error: String(e),
        })
      }
      return
    }
    case 'memory:getConfig': {
      try {
        send({ type: 'memory:config', config: ctx.getMemoryService().getConfig() })
      } catch (e) {
        send({
          type: 'error',
          code: 'MEMORY_CONFIG',
          message: String(e),
        })
      }
      return
    }
    case 'memory:setConfig': {
      try {
        const config = ctx.getMemoryService().setConfig(msg.config)
        send({ type: 'memory:config', config })
      } catch (e) {
        send({
          type: 'error',
          code: 'MEMORY_CONFIG',
          message: String(e),
        })
      }
      return
    }
    case 'memory:consolidate': {
      const svc = ctx.getMemoryService()
      const config = svc.getConfig()
      const llm = createDefaultMemoryLlmClient({ extractModel: config.extractModel })
      send({ type: 'memory:pipeline', phase: 2, status: 'started' })
      void runPhase2Consolidate({
        store: svc.store,
        llm,
        config,
        projectKeyHash: msg.projectKeyHash,
      })
        .then((res) => {
          if (res.status === 'skipped') {
            send({
              type: 'memory:pipeline',
              phase: 2,
              status: 'noop',
              detail: res.reason ?? 'skipped',
            })
            return
          }
          if (res.status === 'failed') {
            send({
              type: 'memory:pipeline',
              phase: 2,
              status: 'failed',
              detail: res.reason,
            })
            return
          }
          // Best-effort decay after successful Phase2.
          try {
            runDecayJob(svc.store, config)
          } catch (err) {
            console.warn(
              '[memory] decay after consolidate failed',
              err instanceof Error ? err.message : String(err),
            )
          }
          send({
            type: 'memory:pipeline',
            phase: 2,
            status: 'succeeded',
            detail: `upserted=${res.upserted ?? 0};archived=${res.archived ?? 0}`,
          })
        })
        .catch((err) => {
          send({
            type: 'memory:pipeline',
            phase: 2,
            status: 'failed',
            detail: err instanceof Error ? err.message : String(err),
          })
        })
      return
    }
    case 'session:setMemoryFlags': {
      const s = ctx.ensureSession(msg.sessionId, send)
      const next: SessionConfig = { ...s.config }
      if (msg.useMemories !== undefined) next.useMemories = msg.useMemories
      if (msg.generateMemories !== undefined) next.generateMemories = msg.generateMemories
      if (msg.incognito !== undefined) next.incognito = msg.incognito
      s._config = next
      ctx.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
      send({
        type: 'session:memoryFlags',
        sessionId: msg.sessionId,
        useMemories: s.config.useMemories,
        generateMemories: s.config.generateMemories,
        incognito: s.config.incognito,
      })
      return
    }
    default:
      return
  }
}
