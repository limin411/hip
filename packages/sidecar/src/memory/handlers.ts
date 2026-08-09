import type { ClientMessage, MemoryItem, Message, SessionConfig } from '@hip/protocol'
import type { Session } from '../session/session.js'
import type { SendFn } from '../session/handlers/types.js'
import type { MemoryService } from './service.js'
import { createDefaultMemoryLlmClient } from './llm-client.js'
import { formatLearnNowDetail, runLearnNow } from './pipeline/learn-now.js'

export const MEMORY_MESSAGE_TYPES = new Set([
  'memory:list',
  'memory:get',
  'memory:upsert',
  'memory:delete',
  'memory:deleteBySourceSession',
  'memory:restore',
  'memory:emptyTrash',
  'memory:export',
  'memory:import',
  'memory:getConfig',
  'memory:setConfig',
  'memory:consolidate',
  'memory:reindex',
  'memory:indexStatus',
  'memory:getStatus',
  'memory:rewriteMirrors',
  'memory:importMirror',
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
    loadMessagesWithRuns?(sessionId: string): Message[]
    listSessions?(): Array<{ id: string; messageCount: number; config?: string }>
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
        // Default remains hard delete (privacy for session-derived items).
        const svc = ctx.getMemoryService()
        const deleted = svc.store.deleteBySourceSession(msg.sessionId, { soft: msg.soft })
        if (deleted > 0) svc.afterMemoryMutation({ all: true })
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
    case 'memory:restore': {
      try {
        const item = ctx.getMemoryService().restore(msg.id)
        if (!item) {
          send({ type: 'memory:restore:result', error: `not found or not deleted: ${msg.id}` })
        } else {
          send({ type: 'memory:restore:result', item })
        }
      } catch (e) {
        send({ type: 'memory:restore:result', error: String(e) })
      }
      return
    }
    case 'memory:emptyTrash': {
      try {
        const deleted = ctx.getMemoryService().emptyTrash()
        send({ type: 'memory:emptyTrash:result', deleted })
      } catch (e) {
        send({ type: 'memory:emptyTrash:result', deleted: 0, error: String(e) })
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
      // Dogfood "Learn now": optional Phase1 on recent chats when stage1 empty, then Phase2.
      const svc = ctx.getMemoryService()
      const config = svc.getConfig()
      const llm = createDefaultMemoryLlmClient({ extractModel: config.extractModel })
      send({ type: 'memory:pipeline', phase: 2, status: 'started' })
      const sessionStore =
        ctx.store?.loadMessagesWithRuns && ctx.store.listSessions
          ? {
              loadMessagesWithRuns: (id: string) => ctx.store!.loadMessagesWithRuns!(id),
              listSessions: () =>
                ctx.store!.listSessions!().map((s) => {
                  const row = ctx.store!.getSession?.(s.id)
                  return {
                    id: s.id,
                    messageCount: s.messageCount,
                    config: row?.config,
                  }
                }),
            }
          : null
      void runLearnNow({
        store: svc.store,
        memoryService: svc,
        llm,
        config,
        sessionStore,
        projectKeyHash: msg.projectKeyHash,
      })
        .then((result) => {
          const res = result.phase2
          const detail = formatLearnNowDetail(result)
          if (res.status === 'skipped') {
            svc.recordPipelineStatus({
              lastPhase2At: Date.now(),
              lastPhase2Status: 'skipped',
              lastPhase2Reason: res.reason ?? 'skipped',
            })
            // Prefer concrete no_stage1 for UI; include phase1 reason in detail for parsing.
            const noopDetail =
              res.reason === 'no_stage1' && result.phase1.lastReason
                ? `no_stage1;${detail}`
                : res.reason ?? 'skipped'
            send({
              type: 'memory:pipeline',
              phase: 2,
              status: 'noop',
              detail: noopDetail,
            })
            return
          }
          if (res.status === 'failed') {
            svc.recordPipelineStatus({
              lastPhase2At: Date.now(),
              lastPhase2Status: 'failed',
              lastPhase2Reason: res.reason,
            })
            send({
              type: 'memory:pipeline',
              phase: 2,
              status: 'failed',
              detail: res.reason ?? detail,
            })
            return
          }
          svc.recordPipelineStatus({
            lastPhase2At: Date.now(),
            lastPhase2Status:
              res.status === 'succeeded_no_output' ? 'succeeded_no_output' : 'succeeded',
            lastPhase2Reason: detail,
          })
          send({
            type: 'memory:pipeline',
            phase: 2,
            status: 'succeeded',
            detail,
          })
        })
        .catch((err) => {
          const detail = err instanceof Error ? err.message : String(err)
          svc.recordPipelineStatus({
            lastPhase2At: Date.now(),
            lastPhase2Status: 'failed',
            lastPhase2Reason: detail,
          })
          send({
            type: 'memory:pipeline',
            phase: 2,
            status: 'failed',
            detail,
          })
        })
      return
    }
    case 'memory:getStatus': {
      try {
        const svc = ctx.getMemoryService()
        const config = svc.getConfig()
        const llm = createDefaultMemoryLlmClient({ extractModel: config.extractModel })
        const status = svc.getPipelineStatus({
          projectKeyHash: msg.projectKeyHash,
          contextWindowTokens: msg.contextWindowTokens,
          llmAvailable: !!llm,
        })
        send({ type: 'memory:status', status })
      } catch (e) {
        send({
          type: 'memory:status',
          status: {
            extractsToday: 0,
            maxExtractsPerDay: 20,
            llmAvailable: false,
            itemCounts: { active: 0, deleted: 0, archived: 0 },
            summaryCounts: { global: 0, project: 0 },
            stage1Pending: 0,
            coreGeneration: 0,
          },
          error: String(e),
        })
      }
      return
    }
    case 'memory:rewriteMirrors': {
      try {
        const written = ctx.getMemoryService().rewriteMirrors(msg.projectKeyHash)
        send({ type: 'memory:rewriteMirrors:result', written })
      } catch (e) {
        send({ type: 'memory:rewriteMirrors:result', written: [], error: String(e) })
      }
      return
    }
    case 'memory:importMirror': {
      try {
        const result = ctx.getMemoryService().importMirror({
          projectKeyHash: msg.projectKeyHash,
          conflict: msg.conflict,
        })
        send({
          type: 'memory:importMirror:result',
          imported: result.imported,
          skipped: result.skipped,
        })
      } catch (e) {
        send({
          type: 'memory:importMirror:result',
          imported: 0,
          skipped: 0,
          error: String(e),
        })
      }
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
