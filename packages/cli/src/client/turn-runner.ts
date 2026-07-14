import type { ClientMessage, Message, PermissionOption, ServerMessage } from '@hip/protocol'
import type { HipRunResult, HitlMode, HipRunStatus } from '../types.js'
import { exitForStatus, mapErrorCode } from '../types.js'
import {
  decideInterruptHitl,
  decidePermissionHitl,
  parseInterruptContextKind,
} from './hitl-policy.js'

export interface TurnRunnerOpts {
  sessionId: string
  userMessageId: string
  prompt: string
  hitl: HitlMode
  maxPlanApprovals: number
  settleMs: number
  /** Overall deadline from start; null = none. */
  deadlineAt: number | null
  allowNoKey?: boolean
  isTty?: boolean
  send: (msg: ClientMessage) => void
  /** Subscribe to server messages; return unsubscribe. */
  subscribe: (handler: (msg: ServerMessage) => void) => () => void
  onTextDelta?: (delta: string) => void
  onTool?: (info: { callId: string; name: string; phase: 'start' | 'finish'; error?: string }) => void
  onAgent?: (info: { phase: 'start' | 'finish'; agentId: string; role?: string }) => void
  onReasoning?: (delta: string) => void
  onInterrupt?: (question: string, contextKind?: string) => void
  onTrace?: (type: string, payload?: unknown) => void
}

export interface TurnRunnerOutcome {
  status: HipRunStatus
  exitCode: number
  text: string
  hasApiKeyAtReady?: boolean
  turn: NonNullable<HipRunResult['turn']>
  interrupt?: HipRunResult['interrupt']
  tools: HipRunResult['tools']
  errors: HipRunResult['errors']
  assistantMessageId?: string
  usage?: HipRunResult['usage']
}

type Terminal = Omit<TurnRunnerOutcome, 'turn' | 'tools' | 'text'> & {
  text: string
  turn: NonNullable<HipRunResult['turn']>
  tools: HipRunResult['tools']
}

/**
 * Drive one user turn through ready → create is caller's job;
 * this waits ready (if not yet), then expects session already created,
 * sends message:send, settles complete/interrupt/error.
 *
 * For tests, call with a fake subscribe that pushes messages.
 */
export async function runTurn(opts: TurnRunnerOpts): Promise<TurnRunnerOutcome> {
  const isTty = opts.isTty ?? Boolean(process.stdin.isTTY)
  let text = ''
  const tools: HipRunResult['tools'] = []
  const errors: HipRunResult['errors'] = []
  let completeCount = 0
  let planApprovalsUsed = 0
  let hasApiKeyAtReady: boolean | undefined
  let readySeen = false
  let assistantMessageId: string | undefined
  let lastStopped = false
  let usage: HipRunResult['usage']

  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let overallTimer: ReturnType<typeof setTimeout> | null = null
  let settledResolve: ((t: Terminal) => void) | null = null

  const trace = (type: string, payload?: unknown) => {
    opts.onTrace?.(type, payload)
  }

  const finish = (t: Terminal) => {
    if (settleTimer) clearTimeout(settleTimer)
    if (overallTimer) clearTimeout(overallTimer)
    if (settledResolve) {
      const r = settledResolve
      settledResolve = null
      r({ ...t, usage: t.usage ?? usage })
    }
  }

  const terminalOk = (): Terminal => ({
    status: 'ok',
    exitCode: 0,
    text,
    hasApiKeyAtReady,
    turn: {
      userMessageId: opts.userMessageId,
      assistantMessageId,
      stopped: false,
      completeCount,
    },
    tools,
    errors,
    usage,
  })

  const terminalStatus = (
    status: HipRunStatus,
    extra?: Partial<Terminal>,
  ): Terminal => ({
    status,
    exitCode: exitForStatus(status),
    text,
    hasApiKeyAtReady,
    turn: {
      userMessageId: opts.userMessageId,
      assistantMessageId,
      stopped: lastStopped || status === 'awaiting_user' || status === 'hitl_blocked',
      completeCount,
    },
    tools,
    errors,
    usage,
    ...extra,
  })

  const enterSettle = () => {
    if (settleTimer) clearTimeout(settleTimer)
    const remaining =
      opts.deadlineAt != null ? Math.max(0, opts.deadlineAt - Date.now()) : opts.settleMs
    const windowMs = Math.min(opts.settleMs, remaining || opts.settleMs)
    settleTimer = setTimeout(() => {
      errors.push({ code: 'SETTLE_TIMEOUT', message: 'stopped complete without interrupt/error' })
      finish(terminalStatus('awaiting_user'))
    }, windowMs)
  }

  const handleError = (code: string, message: string) => {
    errors.push({ code, message })
    const mapped = mapErrorCode(code)
    finish(
      terminalStatus(mapped.status, {
        exitCode: mapped.exitCode,
      }),
    )
  }

  const handleInterrupt = (msg: Extract<ServerMessage, { type: 'agent:interrupt' }>) => {
    if (settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
    const contextKind = parseInterruptContextKind(msg.context)
    opts.onInterrupt?.(msg.question, contextKind)
    trace('agent:interrupt', { question: msg.question, contextKind })
    const decision = decideInterruptHitl(
      opts.hitl,
      contextKind,
      planApprovalsUsed,
      opts.maxPlanApprovals,
      isTty,
    )
    const interrupt = {
      question: msg.question,
      contextKind,
      contextRaw: msg.context,
    }

    if (decision.action === 'allow' && contextKind === 'plan_approval') {
      planApprovalsUsed++
      opts.send({ type: 'plan:respond', sessionId: opts.sessionId, action: 'approve' })
      trace('plan:respond', { action: 'approve' })
      // wait for NEXT terminal
      return
    }

    if (decision.status === 'hitl_blocked') {
      errors.push({ code: 'HITL_FAIL', message: decision.reason ?? 'hitl blocked' })
      finish(terminalStatus('hitl_blocked', { interrupt }))
      return
    }

    errors.push({ code: 'AWAITING_USER', message: decision.reason ?? 'awaiting user' })
    finish(terminalStatus('awaiting_user', { interrupt }))
  }

  const handlePermission = (msg: ServerMessage & { type?: string }) => {
    // permission:request shape from protocol
    const m = msg as {
      type: 'permission:request'
      sessionId: string
      requestId: string
      options?: PermissionOption[]
    }
    const decision = decidePermissionHitl(opts.hitl, m.options, isTty)
    if (decision.action === 'allow' && decision.optionId) {
      opts.send({
        type: 'permission:respond',
        sessionId: opts.sessionId,
        requestId: m.requestId,
        optionId: decision.optionId,
      })
      return
    }
    if (decision.action === 'block') {
      opts.send({
        type: 'permission:respond',
        sessionId: opts.sessionId,
        requestId: m.requestId,
        cancelled: true,
      })
      errors.push({ code: 'HITL_FAIL', message: decision.reason ?? 'permission blocked' })
      finish(terminalStatus(decision.status ?? 'hitl_blocked'))
    }
    // prompt: not fully implemented in P0 headless — treat as awaiting
    if (decision.action === 'prompt') {
      errors.push({ code: 'HITL_PROMPT', message: 'interactive permission not supported in headless' })
      finish(terminalStatus('awaiting_user'))
    }
  }

  const onMessage = (msg: ServerMessage) => {
    if (settledResolve === null) return

    switch (msg.type) {
      case 'ready': {
        readySeen = true
        hasApiKeyAtReady = msg.hasApiKey
        trace('ready', { hasApiKey: msg.hasApiKey })
        if (!msg.hasApiKey && !opts.allowNoKey) {
          errors.push({ code: 'NO_API_KEY_AT_READY', message: 'sidecar has no API key' })
          finish(terminalStatus('error', { exitCode: 1 }))
        }
        break
      }
      case 'token:stream': {
        text += msg.delta
        opts.onTextDelta?.(msg.delta)
        break
      }
      case 'reasoning:delta': {
        opts.onReasoning?.(msg.delta)
        break
      }
      case 'agent:started': {
        opts.onAgent?.({ phase: 'start', agentId: msg.agentId, role: msg.role })
        trace('agent:started', { agentId: msg.agentId, role: msg.role })
        break
      }
      case 'agent:finished': {
        opts.onAgent?.({ phase: 'finish', agentId: msg.agentId })
        trace('agent:finished', { agentId: msg.agentId })
        break
      }
      case 'tool:started': {
        tools.push({ callId: msg.callId, name: msg.name, status: 'running' })
        opts.onTool?.({ callId: msg.callId, name: msg.name, phase: 'start' })
        trace('tool:started', { callId: msg.callId, name: msg.name })
        break
      }
      case 'tool:finished': {
        const t = tools.find((x) => x.callId === msg.callId)
        const toolName = t?.name ?? 'tool'
        if (t) {
          t.status = msg.status === 'error' ? 'error' : 'finished'
          if (msg.error) t.error = msg.error
        } else {
          tools.push({
            callId: msg.callId,
            name: toolName,
            status: msg.status === 'error' ? 'error' : 'finished',
            error: msg.error,
          })
        }
        opts.onTool?.({
          callId: msg.callId,
          name: toolName,
          phase: 'finish',
          error: msg.error,
        })
        trace('tool:finished', { callId: msg.callId, name: toolName, status: msg.status })
        break
      }
      case 'message:complete': {
        completeCount++
        const message = msg.message as Message
        assistantMessageId = message.id
        if (message.usage) {
          usage = {
            inputTokens: message.usage.inputTokens,
            outputTokens: message.usage.outputTokens,
            totalTokens: message.usage.totalTokens,
          }
        }
        if (message.content && typeof message.content === 'string' && !text) {
          text = message.content
        } else if (typeof message.content === 'string' && message.content.length > text.length) {
          text = message.content
        }
        lastStopped = message.stopped === true
        trace('message:complete', { id: message.id, stopped: lastStopped, completeCount })
        if (!lastStopped) {
          finish(terminalOk())
        } else {
          enterSettle()
        }
        break
      }
      case 'agent:interrupt': {
        handleInterrupt(msg)
        break
      }
      case 'error': {
        trace('error', { code: msg.code, message: msg.message })
        handleError(msg.code, msg.message)
        break
      }
      case 'permission:request': {
        trace('permission:request', { requestId: msg.requestId })
        handlePermission(msg)
        break
      }
      default:
        break
    }
  }

  return new Promise<TurnRunnerOutcome>((resolve) => {
    settledResolve = (t) => {
      unsub()
      resolve({
        ...t,
        turn: t.turn,
        tools: t.tools,
        text: t.text,
        errors: t.errors,
        hasApiKeyAtReady,
        assistantMessageId: t.turn.assistantMessageId,
        usage: t.usage ?? usage,
      })
    }

    const unsub = opts.subscribe(onMessage)

    if (opts.deadlineAt != null) {
      const ms = Math.max(0, opts.deadlineAt - Date.now())
      overallTimer = setTimeout(() => {
        try {
          opts.send({ type: 'message:cancel', sessionId: opts.sessionId })
        } catch {
          /* ignore */
        }
        errors.push({ code: 'TIMEOUT', message: 'CLI --timeout expired' })
        finish(terminalStatus('timeout', { exitCode: 4 }))
      }, ms)
    }

    // If ready already required before create, caller handles preflight.
    // Send user message now.
    opts.send({
      type: 'message:send',
      sessionId: opts.sessionId,
      id: opts.userMessageId,
      content: opts.prompt,
      role: 'user',
    })

    // Mark readySeen unused suppress — used for diagnostics
    void readySeen
  })
}

/** Wait for ready message (and optional preflight). */
export async function waitReady(
  subscribe: (handler: (msg: ServerMessage) => void) => () => void,
  opts: { allowNoKey?: boolean; timeoutMs?: number } = {},
): Promise<{ hasApiKey: boolean }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub()
      reject(Object.assign(new Error('ready timeout'), { code: 'HANDSHAKE_TIMEOUT' }))
    }, opts.timeoutMs ?? 15_000)

    const unsub = subscribe((msg) => {
      if (msg.type !== 'ready') return
      clearTimeout(timer)
      unsub()
      if (!msg.hasApiKey && !opts.allowNoKey) {
        reject(
          Object.assign(new Error('sidecar has no API key'), {
            code: 'NO_API_KEY_AT_READY',
            hasApiKey: false,
          }),
        )
        return
      }
      resolve({ hasApiKey: msg.hasApiKey })
    })
  })
}
