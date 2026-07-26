/**
 * Integrate RoundtableRunner into a session turn (stream + finalize).
 * Council mode projects each advisor as a nested agent for the Agents panel,
 * with live token:stream into each agentRun so the right panel shows speech as it generates.
 */
import type { AgentRole, RoundtableMeta, TurnUsage } from '@hip/protocol'
import type { TraceRun } from '../tool-trace.js'
import type { SendFn, SessionTurnHost } from '../session-turn-runner.js'
import { completeFnsFromModelRunner } from './complete.js'
import {
  isCouncilEngine,
  resolveRoundtableLang,
  shouldEnterRoundtableLoop,
  stripRoundtableFrame,
} from './detect.js'
import { resolveRoundtableEngine } from './constants.js'
import { councilDisplayName } from './ids.js'
import { runRoundtable } from './runner.js'
import { renderEventMarkdown } from './render.js'
import { formatSpeechOutput, parseSpeechEnvelope } from './speech-schema.js'
import { logInfo } from '../../debug-logger.js'

/**
 * If the last user message is roundtable-framed and engine is loop/council, run the meeting
 * and return supervisor text. Otherwise return null (caller continues normal runTurn).
 */
export async function tryRunRoundtableTurn(
  host: SessionTurnHost,
  rawSend: SendFn,
  userContent: string,
): Promise<string | null> {
  const engine = resolveRoundtableEngine()
  if (
    !shouldEnterRoundtableLoop(userContent, {
      surface: host._config.surface,
      engine,
    })
  ) {
    return null
  }

  const issue = stripRoundtableFrame(userContent).trim()
  if (!issue) return null

  const council = isCouncilEngine(engine)

  host.abortController = new AbortController()
  host.running = true
  const signal = host.abortController.signal
  const turnId = `asst-supervisor-${Date.now()}-${host.turnSeq++}`
  logInfo('session', 'roundtable:start', { sessionId: host.id, turnId, engine })

  const trajectory = new Map<string, TraceRun>()
  let agentSeq = 0
  trajectory.set('supervisor', {
    role: 'supervisor' as AgentRole,
    output: '',
    startedAt: Date.now(),
    finishedAt: null,
    seq: agentSeq++,
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
  const pushBurst = (content: string) => {
    if (!content) return
    const r = trajectory.get('supervisor')
    if (!r) return
    if (!r.textBursts) r.textBursts = []
    r.textBursts.push({ stepSeq: stepSeq++, content })
    r.output += content
    rawSend({
      type: 'token:stream',
      sessionId: host.id,
      turnId,
      agentId: 'supervisor',
      delta: content,
      stepSeq: stepSeq - 1,
      role: 'supervisor',
    })
  }

  /** Bytes already streamed to FE for each advisor (avoid double-writing on finish). */
  const streamedLen = new Map<string, number>()

  const lang = resolveRoundtableLang(host._config.language)
  const llm = completeFnsFromModelRunner(host.modelRunner())

  try {
    const result = await runRoundtable({
      issue,
      language: lang,
      signal,
      llm,
      councilMode: council,
      onEvent: (ev) => {
        // Slim main transcript for council: skip full speech bodies (detail in Agents panel).
        if (council && ev.kind === 'roundtable.speech') {
          const line =
            lang === 'zh-CN' || lang === 'zh-TW'
              ? `*${councilDisplayName(ev.speaker, lang)} 已发言（详见右侧智能体）*\n\n`
              : `*${councilDisplayName(ev.speaker, lang)} spoke (see Agents panel)*\n\n`
          pushBurst(line)
          return
        }
        const chunk = renderEventMarkdown(ev, lang)
        if (chunk) pushBurst(chunk)
      },
      advisorHooks: council
        ? {
            onStart: ({ speaker, agentId, focus }) => {
              const name = councilDisplayName(speaker, lang)
              // Fresh run state for this speech (re-enter running on multi-round).
              trajectory.set(agentId, {
                role: 'subagent',
                output: '',
                startedAt: Date.now(),
                finishedAt: null,
                seq: agentSeq++,
                toolCalls: new Map(),
                reasoningBursts: [],
                parentAgentId: 'supervisor',
                name,
                taskInput: focus,
              })
              streamedLen.set(agentId, 0)
              // Always re-announce so FE clears finishedAt and shows running.
              rawSend({
                type: 'agent:started',
                sessionId: host.id,
                turnId,
                agentId,
                role: 'subagent',
                parentAgentId: 'supervisor',
                name,
                taskInput: focus,
              })
              host.activeSteps.set(agentId, agentId)
              host.emit({
                type: 'step_started',
                sessionId: host.id,
                turnId: agentId,
                agentId,
                timestamp: Date.now(),
              })
              host.emit({
                type: 'text_started',
                sessionId: host.id,
                messageId: agentId,
                timestamp: Date.now(),
              })
            },
            onToken: ({ agentId, delta }) => {
              if (!delta) return
              const run = trajectory.get(agentId)
              if (run) run.output += delta
              streamedLen.set(agentId, (streamedLen.get(agentId) ?? 0) + delta.length)
              // Subagent path: no stepSeq → FE appends to agentRuns[].output only.
              rawSend({
                type: 'token:stream',
                sessionId: host.id,
                turnId,
                agentId,
                delta,
                role: 'subagent',
              })
            },
            onFinish: ({ agentId, prose, content, round, focus }) => {
              const run = trajectory.get(agentId)
              if (!run) return
              const envelope = parseSpeechEnvelope(content)
              const block = formatSpeechOutput({
                acts: envelope.acts,
                prose: prose || envelope.prose,
              })
              // Prefer live-streamed raw text for panel readability; keep acts footer for machine.
              const streamed = run.output
              const section =
                streamed.trim().length > 0
                  ? `${streamed.trim()}\n\n<!--hip.speech_acts-->\n${JSON.stringify({ acts: envelope.acts })}`
                  : `### Round ${round}${focus ? ` — ${focus}` : ''}\n${block}`

              // If model did not stream (or stream empty), push full prose now.
              if (!streamed.trim() && prose.trim()) {
                rawSend({
                  type: 'token:stream',
                  sessionId: host.id,
                  turnId,
                  agentId,
                  delta: prose,
                  role: 'subagent',
                })
              }

              run.output = section
              run.finishedAt = Date.now()
              rawSend({ type: 'agent:finished', sessionId: host.id, turnId, agentId })
              host.emit({
                type: 'text_ended',
                sessionId: host.id,
                messageId: agentId,
                content: run.output,
                timestamp: Date.now(),
              })
            },
          }
        : undefined,
    })

    for (const [agentId, run] of trajectory) {
      if (agentId === 'supervisor') continue
      if (run.finishedAt == null) {
        run.finishedAt = Date.now()
        rawSend({ type: 'agent:finished', sessionId: host.id, turnId, agentId })
      }
    }

    const stopped = result.phase === 'aborted' && result.abortReason === 'cancelled'
    const text = result.markdown.trim() || (stopped ? '' : '…')
    const r = trajectory.get('supervisor')
    if (r) {
      r.output = text
      r.finishedAt = Date.now()
      if (!r.textBursts?.length && text) {
        r.textBursts = [{ stepSeq: 0, content: text }]
      }
    }

    rawSend({ type: 'agent:finished', sessionId: host.id, turnId, agentId: 'supervisor' })
    host.emit({
      type: 'text_ended',
      sessionId: host.id,
      messageId: turnId,
      content: text,
      timestamp: Date.now(),
    })

    const roundtable: RoundtableMeta = {
      engine: council ? 'council' : 'loop',
      convened: result.convened,
      phase: result.phase,
      advisorCalls: result.advisorCalls,
      ...(result.roundsPlanned != null ? { roundsPlanned: result.roundsPlanned } : {}),
      ...(result.roundsRan != null ? { roundsRan: result.roundsRan } : {}),
      ...(result.earlyExit ? { earlyExit: true } : {}),
      ...(result.edges?.length
        ? {
            edges: result.edges.map((e) => ({
              round: e.round,
              from: e.from,
              to: e.to,
              relation: e.relation,
              summary: e.summary,
            })),
          }
        : {}),
    }

    const usageByAgent = new Map<string, TurnUsage>()
    const finalText = host.finalizeAndPersist(
      rawSend,
      turnId,
      text,
      trajectory,
      stopped,
      usageByAgent,
      undefined,
      { roundtable },
    )

    void host
      .generateFirstTurnTitle({ type: 'message', content: issue }, finalText, rawSend)
      .catch(() => {})

    logInfo('session', 'roundtable:done', {
      sessionId: host.id,
      turnId,
      engine,
      phase: result.phase,
      advisorCalls: result.advisorCalls,
      convened: result.convened,
      agents: [...trajectory.keys()].filter((k) => k !== 'supervisor').length,
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
      if (!r.textBursts?.length) r.textBursts = [{ stepSeq: 0, content: body }]
    }
    for (const [agentId, run] of trajectory) {
      if (agentId === 'supervisor') continue
      if (run.finishedAt == null) {
        run.finishedAt = Date.now()
        rawSend({ type: 'agent:finished', sessionId: host.id, turnId, agentId })
      }
    }
    rawSend({ type: 'agent:finished', sessionId: host.id, turnId, agentId: 'supervisor' })
    host.emit({
      type: 'text_ended',
      sessionId: host.id,
      messageId: turnId,
      content: body,
      timestamp: Date.now(),
    })
    return host.finalizeAndPersist(rawSend, turnId, body, trajectory, true, new Map(), undefined, {
      roundtable: {
        engine: council ? 'council' : 'loop',
        convened: false,
        phase: 'aborted',
        advisorCalls: 0,
      },
    })
  } finally {
    host.running = false
    host.abortController = null
    host.activeSteps.delete('supervisor')
    for (const id of trajectory.keys()) {
      if (id !== 'supervisor') host.activeSteps.delete(id)
    }
  }
}
