/**
 * Integrate RoundtableRunner into a session turn.
 * Council mode delegates each advisor via runManagedAgent (real nested agent runs).
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
import { runCouncilAdvisor } from './council-advisor.js'
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
  // Track council agent ids for cleanup
  const councilAgentIds = new Set<string>()

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

  const lang = resolveRoundtableLang(host._config.language)
  const llm = completeFnsFromModelRunner(host.modelRunner())
  const cwd = host._config.cwd?.trim() || process.cwd()

  const startCouncilAgent = (p: {
    agentId: string
    name: string
    focus: string
  }) => {
    councilAgentIds.add(p.agentId)
    host.spawnedSubagentIds.add(p.agentId)
    host.subagentInstances.set(p.agentId, { description: p.focus })
    trajectory.set(p.agentId, {
      role: 'subagent',
      output: '',
      startedAt: Date.now(),
      finishedAt: null,
      seq: agentSeq++,
      toolCalls: new Map(),
      reasoningBursts: [],
      parentAgentId: 'supervisor',
      name: p.name,
      taskInput: p.focus,
    })
    rawSend({
      type: 'agent:started',
      sessionId: host.id,
      turnId,
      agentId: p.agentId,
      role: 'subagent',
      parentAgentId: 'supervisor',
      name: p.name,
      taskInput: p.focus,
    })
    host.activeSteps.set(p.agentId, p.agentId)
    host.emit({
      type: 'step_started',
      sessionId: host.id,
      turnId: p.agentId,
      agentId: p.agentId,
      timestamp: Date.now(),
    })
    host.emit({
      type: 'text_started',
      sessionId: host.id,
      messageId: p.agentId,
      timestamp: Date.now(),
    })
  }

  const finishCouncilAgent = (agentId: string, text: string) => {
    const run = trajectory.get(agentId)
    if (run) {
      run.output = text
      run.finishedAt = Date.now()
    }
    rawSend({ type: 'agent:finished', sessionId: host.id, turnId, agentId })
    host.emit({
      type: 'text_ended',
      sessionId: host.id,
      messageId: agentId,
      content: text,
      timestamp: Date.now(),
    })
  }

  try {
    const result = await runRoundtable({
      issue,
      language: lang,
      signal,
      llm,
      councilMode: council,
      onEvent: (ev) => {
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
      // Real subagent path for council — not llm.complete projection.
      runAdvisor: council
        ? async ({ speaker, user, focus }) => {
            let toolSeq = 0
            return runCouncilAdvisor(
              {
                runner: host.modelRunner(),
                summarizer: host.summarizer(),
                sessionId: host.id,
                turnId,
                cwd,
                language: lang,
                signal,
                networkPolicy: host.networkPolicy,
                onAgentStart: ({ agentId: id, name, focus: f }) => {
                  startCouncilAgent({ agentId: id, name, focus: f })
                },
                onToken: (id, delta) => {
                  const run = trajectory.get(id)
                  if (run) run.output += delta
                  rawSend({
                    type: 'token:stream',
                    sessionId: host.id,
                    turnId,
                    agentId: id,
                    delta,
                    role: 'subagent',
                  })
                },
                onToolStarted: ({ agentId: id, callId, name, input }) => {
                  const run = trajectory.get(id)
                  const seq = toolSeq++
                  if (run) {
                    run.toolCalls.set(callId, {
                      callId,
                      agentId: id,
                      name,
                      input,
                      status: 'running',
                      seq,
                    })
                  }
                  rawSend({
                    type: 'tool:started',
                    sessionId: host.id,
                    turnId,
                    agentId: id,
                    role: 'subagent',
                    callId,
                    name,
                    input,
                    seq,
                  })
                },
                onToolFinished: ({ agentId: id, callId, status, output, error }) => {
                  const run = trajectory.get(id)
                  const tc = run?.toolCalls.get(callId)
                  if (tc) {
                    tc.status = status
                    if (output !== undefined) tc.output = output
                    if (error !== undefined) tc.error = error
                  }
                  rawSend({
                    type: 'tool:finished',
                    sessionId: host.id,
                    turnId,
                    agentId: id,
                    callId,
                    status,
                    ...(output !== undefined ? { output } : {}),
                    ...(error !== undefined ? { error } : {}),
                  })
                },
                onAgentFinish: ({ agentId: id, text }) => {
                  finishCouncilAgent(id, text)
                },
              },
              { persona: speaker, task: user, focus },
            )
          }
        : undefined,
      // Loop path still uses complete + optional hooks for tests
      advisorHooks: council
        ? undefined
        : {
            onStart: () => {},
            onToken: () => {},
            onFinish: () => {},
          },
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
      agents: [...councilAgentIds],
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
    for (const id of councilAgentIds) {
      host.activeSteps.delete(id)
    }
  }
}
