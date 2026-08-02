import type { ClientMessage } from '@hip/protocol'
import { resolveExecutionMode } from '@hip/protocol'
import { SqliteWorkflowStore } from '../../persistence/workflow-store.js'
import { runProviderProbe } from '../../config/provider-probe.js'
import { CodedError, safeErrorMessage } from '../error.js'
import { logDebug, logInfo } from '../../debug-logger.js'
import { generateEmptyGreeting } from '../empty-greeting-generate.js'
import type { SendFn, SessionLifecycleContext } from './types.js'
import { stripPlanApprovalPause } from '../plan-approval-resync.js'

/** Reject mutations / load against soft-deleted sessions. */
function assertSessionActive(ctx: SessionLifecycleContext, sessionId: string): void {
  if (ctx.isSessionTrashed(sessionId)) {
    throw new CodedError('SESSION_TRASHED', 'Session is in the recycle bin; restore it first')
  }
}

export const SESSION_MESSAGE_TYPES = new Set([
  'session:create',
  'session:destroy',
  'message:compact',
  'message:send',
  'input:enqueue',
  'input:steer',
  'message:cancel',
  'message:regenerate',
  'message:resume',
  'subagent:background',
  'subagent:resume',
  'plan:respond',
  'agent:setConfigOption',
  'agent:setProfile',
  'permission:respond',
  'session:uiToolResult',
  'session:uiToolRead:result',
  'session:uiToolWrite:result',
  'session:terminalContext',
  'session:list',
  'session:load',
  'session:search',
  'session:delete',
  'session:softDelete',
  'session:restore',
  'session:trash:list',
  'session:trash:empty',
  'session:trash:purge',
  'session:rename',
  'session:setCwd',
  'session:setOrchMode',
  'session:setThinking',
  'session:setEffort',
  'session:setSystemPrompt',
  'session:setPermissionMode',
  'session:setForcePlan',
  'session:setExecutionMode',
  'session:setAgent',
  'session:setModel',
  'config:setActiveModel',
  'config:testProvider',
  'ui:emptyGreeting:generate',
  'workflow:run',
  'workflow:getActive',
  'task:list',
  'task:stop',
  'task:getOutput',
])

export function isSessionMessage(msg: ClientMessage): boolean {
  return SESSION_MESSAGE_TYPES.has(msg.type)
}

/**
 * Session lifecycle, turn control, and per-session config.
 * Returns void for fully-sync paths (so callers must not await a Promise
 * for session:create / set* — preserves fire-and-forget handle() ordering).
 * Returns Promise for async paths (message:send, workflow:run, …).
 */
export function handleSessionMessage(
  ctx: SessionLifecycleContext,
  msg: ClientMessage,
  send: SendFn,
): void | Promise<void> {
  switch (msg.type) {
    case 'session:create':
      ctx.createSession(msg.id, msg.config, send)
      return
    case 'session:destroy':
      return ctx.destroySession(msg.sessionId)
    case 'message:compact': {
      assertSessionActive(ctx, msg.sessionId)
      const session = ctx.getSession(msg.sessionId)
      if (!session) {
        send({
          type: 'compact:result',
          sessionId: msg.sessionId,
          ok: false,
          applied: false,
          reason: 'session_not_found',
          tokensBefore: 0,
          tokensAfter: 0,
          messagesBefore: 0,
          messagesAfter: 0,
          error: 'session not found',
        })
        return
      }
      return (async () => {
        try {
          const result = await session.compactNow(msg.focus ? { focus: msg.focus } : undefined)
          send({ type: 'compact:result', sessionId: msg.sessionId, ...result })
        } catch (e) {
          send({
            type: 'compact:result',
            sessionId: msg.sessionId,
            ok: false,
            applied: false,
            reason: 'summarizer_failed',
            tokensBefore: 0,
            tokensAfter: 0,
            messagesBefore: 0,
            messagesAfter: 0,
            error: String(e),
          })
        }
      })()
    }
    case 'message:send':
      assertSessionActive(ctx, msg.sessionId)
      return ctx
        .ensureSession(msg.sessionId, send)
        .sendMessage(msg.content, send, msg.id, msg.attachments, ctx.connectionId ?? null)
    case 'input:enqueue': {
      assertSessionActive(ctx, msg.sessionId)
      const s = ctx.ensureSession(msg.sessionId, send)
      s.enqueueInput({
        type: 'message',
        content: msg.content,
        messageId: msg.id,
        connectionId: ctx.connectionId ?? null,
      })
      return s.drainInputQueue(send)
    }
    case 'input:steer': {
      assertSessionActive(ctx, msg.sessionId)
      const s = ctx.ensureSession(msg.sessionId, send)
      s.enqueueInput({
        type: 'steer',
        content: msg.content,
        messageId: msg.id,
        connectionId: ctx.connectionId ?? null,
      })
      return s.drainInputQueue(send)
    }
    case 'message:cancel':
      ctx.getSession(msg.sessionId)?.cancel()
      return
    case 'message:regenerate':
      assertSessionActive(ctx, msg.sessionId)
      return ctx.ensureSession(msg.sessionId, send).regenerate(send)
    case 'message:resume':
      assertSessionActive(ctx, msg.sessionId)
      return ctx.ensureSession(msg.sessionId, send).resume(msg.content, send, msg.attachments)
    case 'subagent:background': {
      const s = ctx.ensureSession(msg.sessionId, send)
      const ac = new AbortController()
      void s.runBackgroundSubagent(msg.taskId, msg.description, ac.signal, send)
      return
    }
    case 'subagent:resume':
      return ctx.ensureSession(msg.sessionId, send).resumeSubagent(msg.taskId, msg.message, send)
    case 'task:list': {
      const s = ctx.getSession(msg.sessionId)
      if (!s) {
        send({
          type: 'task:snapshot',
          sessionId: msg.sessionId,
          tasks: [],
          runningCounts: { shell: 0, agent: 0, monitor: 0, schedule: 0 },
        })
        return
      }
      s.bindSend(send)
      s.backgroundManager.pushSnapshot()
      return
    }
    case 'task:stop': {
      const s = ctx.ensureSession(msg.sessionId, send)
      s.bindSend(send)
      const result = s.backgroundManager.stop(msg.taskId, msg.reason)
      const ok = result === 'killed'
      send({
        type: 'task:stop:result',
        sessionId: msg.sessionId,
        taskId: msg.taskId,
        ok,
        message: ok ? result : undefined,
        error: ok ? undefined : result,
      })
      return
    }
    case 'task:getOutput': {
      const s = ctx.ensureSession(msg.sessionId, send)
      s.bindSend(send)
      const payload = s.backgroundManager.getOutputStructured(msg.taskId)
      const notFound = payload.error === 'not found'
      send({
        type: 'task:getOutput:result',
        sessionId: msg.sessionId,
        taskId: msg.taskId,
        ok: !notFound,
        payload: notFound ? undefined : payload,
        error: notFound ? payload.error : undefined,
      })
      return
    }
    case 'plan:respond':
      return ctx.ensureSession(msg.sessionId, send).handlePlanResponse(msg.action, send, msg.amendContent)
    case 'agent:setConfigOption':
      return ctx.ensureSession(msg.sessionId, send).setAgentConfigOption(msg.configId, msg.value)
    case 'agent:setProfile': {
      const s = ctx.ensureSession(msg.sessionId, send)
      const ok = s.setAgentProfile(msg.id)
      if (ok) {
        send({ type: 'agent:profiles', sessionId: msg.sessionId, profiles: ctx.profileListFor(s) })
      } else {
        send({ type: 'error', sessionId: msg.sessionId, code: 'INVALID_PROFILE', message: 'Unknown agent profile id' })
      }
      return
    }
    case 'permission:respond': {
      const session = ctx.getSession(msg.sessionId)
      if (!session) return
      const pending = session.permissions.pendingPermissions.has(msg.requestId)
      session.respondPermission(
        msg.requestId,
        msg.cancelled ? { cancelled: true } : { optionId: msg.optionId! },
      )
      // First-wins: only emit resolve when a pending request was accepted.
      if (pending) {
        send({
          type: 'permission:resolved',
          sessionId: msg.sessionId,
          requestId: msg.requestId,
          source: ctx.connectionRole ?? 'unknown',
        })
      }
      return
    }
    case 'session:uiToolResult':
    case 'session:uiToolRead:result':
    case 'session:uiToolWrite:result': {
      const session = ctx.getSession(msg.sessionId)
      session?.permissions.respondUiTool(msg.callId, msg)
      return
    }
    case 'session:terminalContext':
      ctx.setTerminalContext(msg.sessionId, { ...(msg.note ? { note: msg.note } : {}), ...(msg.ringTail ? { ringTail: msg.ringTail } : {}) })
      return
    case 'session:list': {
      const sessions = ctx.listSessions()
      // Always-on audit: how many sessions the UI is about to see (wipe forensics).
      const bySurface = sessions.reduce(
        (acc, s) => {
          acc[s.surface] = (acc[s.surface] ?? 0) + 1
          return acc
        },
        {} as Record<string, number>,
      )
      logInfo('session-list', 'list', {
        count: sessions.length,
        bySurface,
        ids: sessions.slice(0, 40).map((s) => s.id),
      })
      logDebug('session-list', 'list detail', {
        sessions: sessions.map((s) => ({
          id: s.id,
          surface: s.surface,
          cwd: s.cwd,
          title: s.title,
          messageCount: s.messageCount,
          updatedAt: s.updatedAt,
        })),
      })
      send({ type: 'session:list:result', sessions })
      return
    }
    case 'session:load': {
      assertSessionActive(ctx, msg.sessionId)
      // Rebuild live Session (hydrate + restore durable plan pause) before echoing history.
      const live = ctx.ensureSession(msg.sessionId, send)
      const { messages, config } = ctx.loadSession(msg.sessionId)
      const clientConfig = config ? stripPlanApprovalPause(config) : config
      send({ type: 'session:loaded', sessionId: msg.sessionId, messages, config: clientConfig })
      // After FE clears pending on session:loaded, re-emit plan approval if still paused (D4c.1 / PR-PA1).
      return live.emitPlanApprovalResyncIfNeeded(send)
    }
    case 'session:search':
      send({ type: 'session:search:result', query: msg.query, hits: ctx.searchSessions(msg.query) })
      return
    case 'session:delete':
      // HARD only — CLI + trash permanent + retention/empty
      ctx.deleteSessionSync(msg.sessionId, send, {
        deleteDerivedMemories: msg.deleteDerivedMemories,
        reason: typeof msg.reason === 'string' && msg.reason ? msg.reason : 'unknown',
      })
      return
    case 'session:softDelete':
      ctx.softDeleteSessionSync(msg.sessionId, send, {
        deleteDerivedMemories: msg.deleteDerivedMemories,
        reason: typeof msg.reason === 'string' && msg.reason ? msg.reason : 'unknown',
      })
      return
    case 'session:restore':
      ctx.restoreSessionSync(msg.sessionId, send)
      return
    case 'session:trash:list':
      // Opportunistic purge of expired rows when the trash UI opens.
      ctx.purgeTrashSync(send)
      send({ type: 'session:trash:list:result', sessions: ctx.listTrashedSessions() })
      return
    case 'session:trash:empty':
      ctx.emptyTrashSync(send)
      return
    case 'session:trash:purge':
      ctx.purgeTrashSync(send, msg.retentionDays)
      return
    case 'session:rename': {
      assertSessionActive(ctx, msg.sessionId)
      const title = ctx.setCustomTitle(msg.sessionId, msg.title)
      send({ type: 'session:title', sessionId: msg.sessionId, title })
      return
    }
    case 'session:setCwd': {
      assertSessionActive(ctx, msg.sessionId)
      const s = ctx.ensureSession(msg.sessionId, send)
      s.setCwd(msg.cwd)
      ctx.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
      void s.captureSnapshot().catch(() => {})
      // Empty string means unbound; echo what the session actually stores.
      send({ type: 'session:cwd', sessionId: msg.sessionId, cwd: s.config.cwd ?? '' })
      return
    }
    case 'session:setOrchMode': {
      // Deprecated API: product path ignores orchMode for turn routing (agent-driven).
      // Still persist for old clients; echo includes ignoredForTurnRouting for honesty.
      // Does not set pendingWorkflowDef or force workflow turns.
      assertSessionActive(ctx, msg.sessionId)
      const s = ctx.ensureSession(msg.sessionId, send)
      const applied = s.setOrchMode(msg.orchMode)
      if (applied) ctx.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
      send({
        type: 'session:orchMode',
        sessionId: msg.sessionId,
        orchMode: s.orchMode,
        ignoredForTurnRouting: true,
      })
      return
    }
    case 'session:setThinking': {
      assertSessionActive(ctx, msg.sessionId)
      const s = ctx.ensureSession(msg.sessionId, send)
      const applied = s.setThinking(msg.thinking)
      if (applied) ctx.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
      send({ type: 'session:thinking', sessionId: msg.sessionId, thinking: s.config.thinking ?? true })
      return
    }
    case 'session:setEffort': {
      assertSessionActive(ctx, msg.sessionId)
      const s = ctx.ensureSession(msg.sessionId, send)
      const applied = s.setEffort(msg.effort)
      if (applied) ctx.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
      send({ type: 'session:effort', sessionId: msg.sessionId, effort: s.config.effort ?? null })
      return
    }
    case 'session:setSystemPrompt': {
      assertSessionActive(ctx, msg.sessionId)
      const s = ctx.ensureSession(msg.sessionId, send)
      const applied = s.setSystemPrompt(msg.systemPrompt)
      if (applied) ctx.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
      send({ type: 'session:systemPrompt', sessionId: msg.sessionId, systemPrompt: s.config.systemPrompt ?? null })
      return
    }
    case 'session:setPermissionMode': {
      assertSessionActive(ctx, msg.sessionId)
      const s = ctx.ensureSession(msg.sessionId, send)
      const applied = s.setPermissionMode(msg.permissionMode)
      if (applied) ctx.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
      send({
        type: 'session:permissionMode',
        sessionId: msg.sessionId,
        permissionMode: s.config.permissionMode ?? 'edit',
      })
      // Leaving full may clear autopilot — always echo execution dual-write fields.
      if (applied) {
        const mode = resolveExecutionMode(s.config)
        send({ type: 'session:forcePlan', sessionId: msg.sessionId, forcePlan: Boolean(s.config.forcePlan) })
        send({ type: 'session:executionMode', sessionId: msg.sessionId, executionMode: mode })
      }
      return
    }
    case 'session:setForcePlan': {
      assertSessionActive(ctx, msg.sessionId)
      const s = ctx.ensureSession(msg.sessionId, send)
      const applied = s.setForcePlan(msg.forcePlan)
      if (applied) ctx.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
      send({
        type: 'session:forcePlan',
        sessionId: msg.sessionId,
        forcePlan: Boolean(s.config.forcePlan),
      })
      if (applied) {
        send({
          type: 'session:executionMode',
          sessionId: msg.sessionId,
          executionMode: resolveExecutionMode(s.config),
        })
      }
      return
    }
    case 'session:setExecutionMode': {
      assertSessionActive(ctx, msg.sessionId)
      const s = ctx.ensureSession(msg.sessionId, send)
      const applied = s.setExecutionMode(msg.executionMode)
      if (applied) ctx.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
      const mode = resolveExecutionMode(s.config)
      // Always echo current state (reject keeps previous; FE can reconcile).
      send({ type: 'session:forcePlan', sessionId: msg.sessionId, forcePlan: Boolean(s.config.forcePlan) })
      send({ type: 'session:executionMode', sessionId: msg.sessionId, executionMode: mode })
      return
    }
    case 'session:setAgent': {
      assertSessionActive(ctx, msg.sessionId)
      const s = ctx.ensureSession(msg.sessionId, send)
      return s.setAgentId(msg.agentId, send).then(() => undefined)
    }
    case 'session:setModel': {
      assertSessionActive(ctx, msg.sessionId)
      ctx.setGlobalActiveModel(msg.llmProvider, msg.model, msg.baseURL ?? '')
      const s = ctx.ensureSession(msg.sessionId, send)
      const applied = s.setModel(msg.llmProvider)
      if (applied) ctx.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
      ctx.forEachSession((other) => {
        if (other !== s) other.applyActiveModel()
      })
      send({
        type: 'config:activeModel',
        providerID: msg.llmProvider,
        modelID: msg.model,
        hasApiKey: ctx.hasApiKey(msg.llmProvider),
      })
      send({
        type: 'session:model',
        sessionId: msg.sessionId,
        llmProvider: msg.llmProvider,
        model: msg.model,
      })
      return
    }
    case 'config:setActiveModel': {
      ctx.setGlobalActiveModel(msg.providerID, msg.modelID, msg.baseURL)
      ctx.applyActiveModelToAll()
      send({
        type: 'config:activeModel',
        providerID: msg.providerID,
        modelID: msg.modelID,
        hasApiKey: ctx.hasApiKey(msg.providerID),
      })
      return
    }
    case 'config:testProvider': {
      const { requestId } = msg
      // Always-reply: every request must produce config:testProvider:result
      // (outer SessionManager only emits generic `error` on throw).
      return (async () => {
        try {
          if (process.env.HIP_KEY_PROBE === '0') {
            send({
              type: 'config:testProvider:result',
              requestId,
              ok: false,
              code: 'PROBE_DISABLED',
              message: 'Key probe disabled (HIP_KEY_PROBE=0)',
              checkedAt: Date.now(),
            })
            return
          }
          const result = await runProviderProbe({
            purpose: msg.purpose,
            providerID: msg.providerID,
            baseURL: msg.baseURL,
            modelID: msg.modelID,
            draftApiKey: msg.apiKey,
          })
          send({ type: 'config:testProvider:result', requestId, ...result })
        } catch (err) {
          send({
            type: 'config:testProvider:result',
            requestId,
            ok: false,
            code: 'INTERNAL',
            message: safeErrorMessage(err),
            checkedAt: Date.now(),
          })
        }
      })()
    }
    case 'ui:emptyGreeting:generate': {
      const { requestId, providerID, modelID, context } = msg
      // Always-reply; built-in model path only (no session/tools/ACP).
      return (async () => {
        try {
          const result = await generateEmptyGreeting({
            providerID,
            modelID,
            context,
          })
          if (result.ok) {
            send({
              type: 'ui:emptyGreeting:generate:result',
              requestId,
              ok: true,
              title: result.title,
              sub: result.sub,
            })
          } else {
            send({
              type: 'ui:emptyGreeting:generate:result',
              requestId,
              ok: false,
              error: result.error,
            })
          }
        } catch (err) {
          send({
            type: 'ui:emptyGreeting:generate:result',
            requestId,
            ok: false,
            error: safeErrorMessage(err),
          })
        }
      })()
    }
    case 'workflow:run': {
      assertSessionActive(ctx, msg.sessionId)
      const s = ctx.ensureSession(msg.sessionId, send)
      if (s.running || s.switchingAgent) {
        send({ type: 'error', sessionId: msg.sessionId, code: 'BUSY', message: 'Session is busy' })
        return
      }
      return void s.runWorkflowTurn(msg.def, send, { runInputs: msg.runInputs })
    }
    case 'workflow:getActive': {
      const wfStore = ctx.store?.getDb ? new SqliteWorkflowStore(ctx.store.getDb()) : undefined
      const latest = wfStore?.loadLatestRunForSession(msg.sessionId) ?? null
      if (latest) {
        send({
          type: 'workflow:snapshot',
          sessionId: msg.sessionId,
          runId: latest.state.runId,
          def: latest.def,
          state: latest.state,
        })
      } else {
        send({ type: 'workflow:cleared', sessionId: msg.sessionId })
      }
      return
    }
    default:
      return
  }
}
