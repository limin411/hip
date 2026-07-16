import type { ClientMessage } from '@hip/protocol'
import { SqliteWorkflowStore } from '../../persistence/workflow-store.js'
import { runProviderProbe } from '../../config/provider-probe.js'
import { safeErrorMessage } from '../error.js'
import type { SendFn, SessionLifecycleContext } from './types.js'

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
  'session:list',
  'session:load',
  'session:search',
  'session:delete',
  'session:rename',
  'session:setCwd',
  'session:setOrchMode',
  'session:setThinking',
  'session:setSystemPrompt',
  'session:setPermissionMode',
  'session:setForcePlan',
  'session:setModel',
  'config:setActiveModel',
  'config:testProvider',
  'workflow:run',
  'workflow:getActive',
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
      return ctx.ensureSession(msg.sessionId, send).sendMessage(msg.content, send, msg.id, msg.attachments)
    case 'input:enqueue': {
      const s = ctx.ensureSession(msg.sessionId, send)
      s.enqueueInput({ type: 'message', content: msg.content, messageId: msg.id })
      return s.drainInputQueue(send)
    }
    case 'input:steer': {
      const s = ctx.ensureSession(msg.sessionId, send)
      s.enqueueInput({ type: 'steer', content: msg.content, messageId: msg.id })
      return s.drainInputQueue(send)
    }
    case 'message:cancel':
      ctx.getSession(msg.sessionId)?.cancel()
      return
    case 'message:regenerate':
      return ctx.ensureSession(msg.sessionId, send).regenerate(send)
    case 'message:resume':
      return ctx.ensureSession(msg.sessionId, send).resume(msg.content, send, msg.attachments)
    case 'subagent:background': {
      const s = ctx.ensureSession(msg.sessionId, send)
      const ac = new AbortController()
      void s.runBackgroundSubagent(msg.taskId, msg.description, ac.signal, send)
      return
    }
    case 'subagent:resume':
      return ctx.ensureSession(msg.sessionId, send).resumeSubagent(msg.taskId, msg.message, send)
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
    case 'permission:respond':
      ctx.getSession(msg.sessionId)?.respondPermission(
        msg.requestId,
        msg.cancelled ? { cancelled: true } : { optionId: msg.optionId! },
      )
      return
    case 'session:list':
      send({ type: 'session:list:result', sessions: ctx.listSessions() })
      return
    case 'session:load': {
      const { messages, config } = ctx.loadSession(msg.sessionId)
      send({ type: 'session:loaded', sessionId: msg.sessionId, messages, config })
      return
    }
    case 'session:search':
      send({ type: 'session:search:result', query: msg.query, hits: ctx.searchSessions(msg.query) })
      return
    case 'session:delete':
      ctx.deleteSessionSync(msg.sessionId, send, {
        deleteDerivedMemories: msg.deleteDerivedMemories,
      })
      return
    case 'session:rename': {
      const title = ctx.setCustomTitle(msg.sessionId, msg.title)
      send({ type: 'session:title', sessionId: msg.sessionId, title })
      return
    }
    case 'session:setCwd': {
      const s = ctx.ensureSession(msg.sessionId, send)
      s.setCwd(msg.cwd)
      ctx.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
      void s.captureSnapshot().catch(() => {})
      send({ type: 'session:cwd', sessionId: msg.sessionId, cwd: msg.cwd })
      return
    }
    case 'session:setOrchMode': {
      // Deprecated API: product path ignores orchMode for turn routing (agent-driven).
      // Still persist for old clients; echo includes ignoredForTurnRouting for honesty.
      // Does not set pendingWorkflowDef or force workflow turns.
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
      const s = ctx.ensureSession(msg.sessionId, send)
      const applied = s.setThinking(msg.thinking)
      if (applied) ctx.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
      send({ type: 'session:thinking', sessionId: msg.sessionId, thinking: s.config.thinking ?? true })
      return
    }
    case 'session:setSystemPrompt': {
      const s = ctx.ensureSession(msg.sessionId, send)
      const applied = s.setSystemPrompt(msg.systemPrompt)
      if (applied) ctx.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
      send({ type: 'session:systemPrompt', sessionId: msg.sessionId, systemPrompt: s.config.systemPrompt ?? null })
      return
    }
    case 'session:setPermissionMode': {
      const s = ctx.ensureSession(msg.sessionId, send)
      const applied = s.setPermissionMode(msg.permissionMode)
      if (applied) ctx.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
      send({
        type: 'session:permissionMode',
        sessionId: msg.sessionId,
        permissionMode: s.config.permissionMode ?? 'edit',
      })
      return
    }
    case 'session:setForcePlan': {
      const s = ctx.ensureSession(msg.sessionId, send)
      const applied = s.setForcePlan(msg.forcePlan)
      if (applied) ctx.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
      send({
        type: 'session:forcePlan',
        sessionId: msg.sessionId,
        forcePlan: Boolean(s.config.forcePlan),
      })
      return
    }
    case 'session:setModel': {
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
    case 'workflow:run': {
      const s = ctx.ensureSession(msg.sessionId, send)
      if (s.running) {
        send({ type: 'error', sessionId: msg.sessionId, code: 'BUSY', message: 'Session is busy' })
        return
      }
      return s.runWorkflowTurn(msg.def, send, { runInputs: msg.runInputs })
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
