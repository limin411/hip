/**
 * Integrate RoundtableRunner into a session turn.
 * Council mode delegates each advisor via runManagedAgent (real nested agent runs).
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
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
import { runRoundtable } from './runner.js'
import { renderEventMarkdown } from './render.js'
import { runCouncilAdvisor } from './council-advisor.js'
import {
  buildRoundtableReportBundle,
  ROUNDTABLE_REPORT_FILENAME,
} from './report.js'
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
    // Carry prior-round speech when the same seat speaks again.
    const existing = trajectory.get(p.agentId)
    const prior =
      existing?.output?.trim() && existing.finishedAt != null
        ? existing.output.trim() + '\n\n---\n\n'
        : existing?.output ?? ''
    trajectory.set(p.agentId, {
      role: 'subagent',
      output: prior,
      startedAt: existing?.startedAt ?? Date.now(),
      finishedAt: null,
      seq: existing?.seq ?? agentSeq++,
      toolCalls: existing?.toolCalls ?? new Map(),
      reasoningBursts: existing?.reasoningBursts ?? [],
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
      // onToken streams into output (after optional prior-round carry).
      // If nothing streamed, attach this round's speech after the separator.
      const cur = (run.output ?? '').trimEnd()
      const speech = text.trim()
      if (!cur) {
        run.output = speech
      } else if (speech && cur.endsWith('---')) {
        run.output = `${cur}\n\n${speech}`
      } else if (speech && !cur.includes(speech.slice(0, Math.min(24, speech.length)))) {
        // Restart without stream: replace only if we still only have prior block.
        run.output = cur.includes('---') ? `${cur}\n\n${speech}` : speech
      }
      run.finishedAt = Date.now()
    }
    rawSend({ type: 'agent:finished', sessionId: host.id, turnId, agentId })
    host.emit({
      type: 'text_ended',
      sessionId: host.id,
      messageId: agentId,
      content: run?.output ?? text,
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
        // Council advisor speech lives only in agentRuns (Agents panel) —
        // do not inject placeholder lines into the main transcript.
        if (council && ev.kind === 'roundtable.speech') return
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

    // End-of-meeting HTML deliverables: hip summary + per-role sub-reports.
    let reportNote = ''
    if (result.convened && result.report && result.phase === 'done') {
      try {
        const bundle = buildRoundtableReportBundle({
          issue: result.report.issue,
          language: lang,
          agenda: result.report.agenda,
          rationale: result.report.rationale,
          rounds: result.report.rounds,
          decision: result.report.decision,
          edges: result.edges,
          earlyExit: result.report.earlyExit ?? result.earlyExit,
          generatedAt: new Date().toISOString(),
        })
        await fs.mkdir(cwd, { recursive: true })
        const sup = trajectory.get('supervisor')
        const written: Array<{ rel: string; abs: string; bytes: number }> = []
        const baseTs = Date.now()

        for (let i = 0; i < bundle.length; i++) {
          const file = bundle[i]!
          const absPath = path.join(cwd, file.filename)
          await fs.writeFile(absPath, file.html, 'utf8')
          written.push({ rel: file.filename, abs: absPath, bytes: file.html.length })

          // Absolute path so write-follow + "open in browser" pass cwd trust checks.
          const callId = `roundtable-report-${baseTs}-${i}`
          const input = JSON.stringify({ path: absPath })
          const seq = sup?.toolCalls.size ?? i
          if (sup) {
            sup.toolCalls.set(callId, {
              callId,
              agentId: 'supervisor',
              name: 'write_file',
              input,
              status: 'finished',
              seq,
              output: `wrote ${file.filename} (${file.html.length} bytes)`,
            })
          }
          rawSend({
            type: 'tool:started',
            sessionId: host.id,
            turnId,
            agentId: 'supervisor',
            role: 'supervisor',
            callId,
            name: 'write_file',
            input,
            seq,
          })
          rawSend({
            type: 'tool:finished',
            sessionId: host.id,
            turnId,
            agentId: 'supervisor',
            callId,
            status: 'finished',
            output: `wrote ${file.filename} (${file.html.length} bytes)`,
          })
        }

        const mainRel = ROUNDTABLE_REPORT_FILENAME
        const roleRels = written
          .filter((w) => w.rel !== mainRel)
          .map((w) => w.rel)
        const roleList =
          roleRels.length > 0
            ? roleRels.map((p) => `- [\`${p}\`](${p})`).join('\n')
            : ''
        reportNote =
          lang === 'zh-CN' || lang === 'zh-TW'
            ? `\n\n---\n\n**圆桌报告（hip 汇总）：** [\`${mainRel}\`](${mainRel})\n` +
              (roleList
                ? `\n**各角色子报告：**\n${roleList}\n\n（汇总页可跳转子报告；浏览器打开后链接可用，或在右侧文件列表中打开）\n`
                : `\n（已写入工作区，可在右侧预览）\n`)
            : lang === 'ja'
              ? `\n\n---\n\n**円卓レポート (hip):** [\`${mainRel}\`](${mainRel})\n` +
                (roleList ? `\n**役割別:**\n${roleList}\n` : '')
              : lang === 'ko'
                ? `\n\n---\n\n**원탁 보고서 (hip):** [\`${mainRel}\`](${mainRel})\n` +
                  (roleList ? `\n**역할별:**\n${roleList}\n` : '')
                : `\n\n---\n\n**Roundtable report (hip summary):** [\`${mainRel}\`](${mainRel})\n` +
                  (roleList
                    ? `\n**Role reports:**\n${roleList}\n\n(Open the summary in a browser to follow cross-links, or open files from the preview panel.)\n`
                    : `\n(Saved; open in the preview panel)\n`)
        pushBurst(reportNote)
        logInfo('session', 'roundtable:report', {
          sessionId: host.id,
          turnId,
          files: written.map((w) => ({ path: w.abs, bytes: w.bytes })),
          count: written.length,
        })
      } catch (err) {
        logInfo('session', 'roundtable:report-error', {
          sessionId: host.id,
          turnId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const stopped = result.phase === 'aborted' && result.abortReason === 'cancelled'
    const text = (result.markdown.trim() + reportNote).trim() || (stopped ? '' : '…')
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
