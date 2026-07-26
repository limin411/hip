/**
 * Integrate RoundtableRunner into a session turn (stream + finalize).
 */
import type { AgentRole, TurnUsage } from '@hip/protocol'
import type { TraceRun } from '../tool-trace.js'
import type { SendFn, SessionTurnHost } from '../session-turn-runner.js'
import { completeFnsFromModelRunner } from './complete.js'
import { resolveRoundtableLang, shouldEnterRoundtableLoop, stripRoundtableFrame } from './detect.js'
import { runRoundtable } from './runner.js'
import { logInfo } from '../../debug-logger.js'

/**
 * If the last user message is roundtable-framed and engine is loop, run the meeting
 * and return supervisor text. Otherwise return null (caller continues normal runTurn).
 */
export async function tryRunRoundtableTurn(
  host: SessionTurnHost,
  rawSend: SendFn,
  userContent: string,
): Promise<string | null> {
  if (
    !shouldEnterRoundtableLoop(userContent, {
      surface: host._config.surface,
    })
  ) {
    return null
  }

  const issue = stripRoundtableFrame(userContent).trim()
  if (!issue) return null

  // Mirror normal turn bookkeeping
  host.abortController = new AbortController()
  host.running = true
  const signal = host.abortController.signal
  const turnId = `asst-supervisor-${Date.now()}-${host.turnSeq++}`
  logInfo('session', 'roundtable:start', { sessionId: host.id, turnId })

  const trajectory = new Map<string, TraceRun>()
  trajectory.set('supervisor', {
    role: 'supervisor' as AgentRole,
    output: '',
    startedAt: Date.now(),
    finishedAt: null,
    seq: 0,
    toolCalls: new Map(),
    reasoningBursts: [],
    textBursts: [],
  })

  rawSend({
    type: 'agent:started',
    sessionId: host.id,
    turnId,
    agentId: 'supervisor',
    role: 'supervisor',
  })
  host.activeSteps.set('supervisor', turnId)
  host.emit({
    type: 'step_started',
    sessionId: host.id,
    turnId,
    agentId: 'supervisor',
    timestamp: Date.now(),
  })
  host.emit({
    type: 'text_started',
    sessionId: host.id,
    messageId: turnId,
    timestamp: Date.now(),
  })

  let stepSeq = 0
  const sendDelta = (delta: string) => {
    if (!delta) return
    const r = trajectory.get('supervisor')
    if (r) r.output += delta
    rawSend({
      type: 'token:stream',
      sessionId: host.id,
      turnId,
      agentId: 'supervisor',
      delta,
      stepSeq: stepSeq++,
      role: 'supervisor',
    })
  }

  const lang = resolveRoundtableLang(host._config.language)
  const llm = completeFnsFromModelRunner(host.modelRunner())

  try {
    const result = await runRoundtable({
      issue,
      language: lang,
      signal,
      llm,
      onMarkdownDelta: sendDelta,
    })

    const stopped = result.phase === 'aborted' && result.abortReason === 'cancelled'
    const text = result.markdown.trim() || (stopped ? '' : '…')
    const r = trajectory.get('supervisor')
    if (r) {
      r.output = text
      r.finishedAt = Date.now()
    }

    rawSend({ type: 'agent:finished', sessionId: host.id, turnId, agentId: 'supervisor' })
    host.emit({
      type: 'text_ended',
      sessionId: host.id,
      messageId: turnId,
      content: text,
      timestamp: Date.now(),
    })

    const usageByAgent = new Map<string, TurnUsage>()
    const finalText = host.finalizeAndPersist(
      rawSend,
      turnId,
      text,
      trajectory,
      stopped,
      usageByAgent,
    )

    // First-turn title from issue + decision snippet
    void host.generateFirstTurnTitle(
      { type: 'message', content: issue },
      finalText,
      rawSend,
    ).catch(() => {})

    logInfo('session', 'roundtable:done', {
      sessionId: host.id,
      turnId,
      phase: result.phase,
      advisorCalls: result.advisorCalls,
      convened: result.convened,
    })
    return finalText
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logInfo('session', 'roundtable:error', { sessionId: host.id, turnId, error: msg })
    const r = trajectory.get('supervisor')
    const partial = (r?.output ?? '').trim()
    const body = partial || `Roundtable failed: ${msg}`
    if (r) {
      r.output = body
      r.finishedAt = Date.now()
    }
    rawSend({ type: 'agent:finished', sessionId: host.id, turnId, agentId: 'supervisor' })
    host.emit({
      type: 'text_ended',
      sessionId: host.id,
      messageId: turnId,
      content: body,
      timestamp: Date.now(),
    })
    return host.finalizeAndPersist(rawSend, turnId, body, trajectory, true, new Map())
  } finally {
    host.running = false
    host.abortController = null
    host.activeSteps.delete('supervisor')
  }
}
