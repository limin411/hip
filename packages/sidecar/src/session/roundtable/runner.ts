/**
 * Roundtable multi-round chair loop (docs/design/roundtable-loop.md).
 */
import {
  CHAIR_PARSE_RETRIES,
  MAX_ADVISOR_CALLS_PER_MEETING,
  MAX_ADVISORS_PER_ROUND,
  MAX_CHAIR_ACTIONS,
  ROUNDTABLE_ROUNDS_MAX,
  ROUNDTABLE_ROUNDS_MIN,
} from './constants.js'
import { resolveRoundtableLang } from './detect.js'
import { updateMinutes } from './minutes.js'
import {
  advisorSystemPrompt,
  advisorUserPrompt,
  chairSystemPrompt,
  chairUserForDecide,
  chairUserForOpenRound,
  chairUserForPlan,
  chairUserForRoute,
  chairUserForStage,
} from './prompts.js'
import { dedupeEdges, edgesFromEnvelope, type CouncilEdge } from './edges.js'
import { councilAgentId } from './ids.js'
import { renderEventMarkdown } from './render.js'
import { parseChairActionFromText } from './schema.js'
import { parseSpeechEnvelope } from './speech-schema.js'
import {
  PERSONA_IDS,
  type ChairAction,
  type PersonaId,
  type RunRoundtableArgs,
  type RoundtableEvent,
  type RoundtableResult,
  type SpeechRecord,
  type StageRecord,
} from './types.js'

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const err = new Error('aborted')
    err.name = 'AbortError'
    throw err
  }
}

export async function runRoundtable(args: RunRoundtableArgs): Promise<RoundtableResult> {
  const lang = resolveRoundtableLang(args.language)
  const signal = args.signal
  const maxAdvisor = args.maxAdvisorCalls ?? MAX_ADVISOR_CALLS_PER_MEETING
  const maxChair = args.maxChairActions ?? MAX_CHAIR_ACTIONS
  const maxPerRound = args.maxAdvisorsPerRound ?? MAX_ADVISORS_PER_ROUND
  const roundsMin = args.roundsMin ?? ROUNDTABLE_ROUNDS_MIN
  const roundsMax = args.roundsMax ?? ROUNDTABLE_ROUNDS_MAX
  const wallClockMs = args.wallClockMs ?? 180_000
  const startedAt = Date.now()

  let advisorCalls = 0
  let chairActions = 0
  let minutes = ''
  let markdown = ''
  let convened = false
  let earlyExit = false
  let roundsPlanned: number | undefined
  let roundsRan = 0
  const stages: StageRecord[] = []
  const allEdges: CouncilEdge[] = []
  const councilMode = Boolean(args.councilMode || args.advisorHooks || args.runAdvisor)
  const edgeField = () => {
    const e = dedupeEdges(allEdges)
    return e.length ? { edges: e } : {}
  }

  const emit = (ev: RoundtableEvent) => {
    args.onEvent?.(ev)
    const chunk = renderEventMarkdown(ev, lang)
    if (chunk) {
      markdown += chunk
      args.onMarkdownDelta?.(chunk)
    }
  }

  const throwIfBudget = () => {
    throwIfAborted(signal)
    if (Date.now() - startedAt > wallClockMs) {
      throw new Error('roundtable wall-clock budget exceeded')
    }
  }

  const chairOnce = async (
    expect: ChairAction['type'] | ChairAction['type'][],
    user: string,
  ): Promise<ChairAction> => {
    const allowed = new Set(Array.isArray(expect) ? expect : [expect])
    let lastErr: Error | undefined
    for (let attempt = 0; attempt <= CHAIR_PARSE_RETRIES; attempt++) {
      throwIfBudget()
      if (chairActions >= maxChair) {
        throw new Error('max chair actions exceeded')
      }
      chairActions++
      const repair =
        attempt === 0
          ? ''
          : `\n\nPrevious output was invalid (${lastErr?.message ?? 'parse error'}). Emit ONLY valid JSON for type in [${[...allowed].join(', ')}].`
      const text = await args.llm.complete({
        system: chairSystemPrompt(lang),
        user: user + repair,
        signal,
        tag: `chair:${[...allowed].join('|')}`,
      })
      try {
        const action = parseChairActionFromText(text)
        if (!allowed.has(action.type)) {
          throw new Error(`expected ${[...allowed].join('|')}, got ${action.type}`)
        }
        return action
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e))
      }
    }
    throw lastErr ?? new Error('chair parse failed')
  }

  try {
    // ── Route ──
    const route = await chairOnce('route', chairUserForRoute(args.issue))
    if (route.type !== 'route') throw new Error('expected route')

    if (!route.convene) {
      emit({ kind: 'roundtable.route', convene: false })
      emit({ kind: 'roundtable.normal_reply', content: route.reply })
      emit({ kind: 'roundtable.done', convened: false, advisorCalls: 0 })
      return {
        phase: 'done',
        convened: false,
        markdown: markdown.trim() + '\n',
        advisorCalls: 0,
        chairActions,
      }
    }

    convened = true
    emit({
      kind: 'roundtable.route',
      convene: true,
      ...(route.reason ? { reason: route.reason } : {}),
    })

    // ── Plan ──
    const plan = await chairOnce('plan', chairUserForPlan(args.issue, route.reason))
    if (plan.type !== 'plan') throw new Error('expected plan')
    let N = plan.rounds
    N = Math.min(roundsMax, Math.max(roundsMin, N)) as 2 | 3 | 4
    const agenda = plan.agenda.slice(0, N)
    while (agenda.length < N) agenda.push(`Round ${agenda.length + 1}`)
    roundsPlanned = N
    emit({
      kind: 'roundtable.plan',
      rounds: N,
      agenda,
      rationale: plan.rationale,
    })

    // ── Rounds ──
    for (let r = 1; r <= N; r++) {
      throwIfBudget()
      if (advisorCalls >= maxAdvisor) break

      const open = await chairOnce(
        'open_round',
        chairUserForOpenRound({
          issue: args.issue,
          minutes,
          round: r,
          agendaLine: agenda[r - 1] ?? `Round ${r}`,
          plannedRounds: N,
        }),
      )
      if (open.type !== 'open_round') throw new Error('expected open_round')
      // Council: pad to ≥3 speakers and force parallel so the Agents panel shows
      // multiple people speaking at once (serial feels like a monologue).
      let speakers = open.speakers.slice(0, maxPerRound)
      if (councilMode) {
        const want = Math.min(Math.max(3, speakers.length), maxPerRound, 5)
        for (const p of PERSONA_IDS) {
          if (speakers.length >= want) break
          if (!speakers.includes(p)) speakers.push(p)
        }
      }
      const speakMode: 'serial_react' | 'parallel_then_synth' =
        councilMode && speakers.length > 1
          ? 'parallel_then_synth'
          : open.mode === 'parallel_then_synth'
            ? 'parallel_then_synth'
            : 'serial_react'
      emit({
        kind: 'roundtable.round_open',
        round: r,
        focus: open.focus,
        speakers,
      })

      const roundLocal: SpeechRecord[] = []
      const remainingSlots = Math.max(0, maxAdvisor - advisorCalls)
      const speakersThisRound = speakers.slice(0, remainingSlots)

      const runOneAdvisor = async (
        speaker: PersonaId,
        prior: SpeechRecord[],
        tagSuffix: string,
      ): Promise<SpeechRecord> => {
        const agentId = councilAgentId(speaker)
        await args.advisorHooks?.onStart?.({
          speaker,
          round: r,
          focus: open.focus,
          agentId,
        })
        const system = advisorSystemPrompt(speaker, lang)
        const user = advisorUserPrompt({
          issue: args.issue,
          minutes,
          focus: open.focus,
          priorThisRound: prior,
          persona: speaker,
          lang,
        })
        // Prefer real managed-agent delegation when provided (council path).
        const speech = args.runAdvisor
          ? await args.runAdvisor({
              speaker,
              system,
              user,
              signal,
              round: r,
              focus: open.focus,
              agentId,
            })
          : await args.llm.complete({
              system,
              user,
              signal,
              tag: `advisor:${speaker}${tagSuffix}`,
              onText: (delta) => {
                args.advisorHooks?.onToken?.({ agentId, delta })
              },
            })
        const raw = speech.trim() || '…'
        const envelope = councilMode ? parseSpeechEnvelope(raw) : { acts: [], prose: raw }
        const content = envelope.prose.trim() || raw
        if (councilMode) {
          allEdges.push(...edgesFromEnvelope(r, speaker, envelope))
        }
        await args.advisorHooks?.onFinish?.({
          speaker,
          round: r,
          focus: open.focus,
          agentId,
          content: raw,
          prose: content,
        })
        return { speaker, content }
      }

      if (speakMode === 'parallel_then_synth' && speakersThisRound.length > 1) {
        throwIfBudget()
        const results = await Promise.all(
          speakersThisRound.map((speaker) => runOneAdvisor(speaker, [], ':parallel')),
        )
        advisorCalls += results.length
        for (const speaker of speakersThisRound) {
          const hit = results.find((x) => x.speaker === speaker) ?? {
            speaker,
            content: '…',
          }
          roundLocal.push(hit)
          emit({ kind: 'roundtable.speech', round: r, speaker: hit.speaker, content: hit.content })
        }
      } else {
        for (const speaker of speakersThisRound) {
          throwIfBudget()
          if (advisorCalls >= maxAdvisor) break
          advisorCalls++
          const rec = await runOneAdvisor(speaker, roundLocal, '')
          roundLocal.push(rec)
          emit({ kind: 'roundtable.speech', round: r, speaker, content: rec.content })
        }
      }

      const stageAction = await chairOnce(
        'stage',
        chairUserForStage({
          issue: args.issue,
          minutes,
          round: r,
          plannedRounds: N,
          speeches: roundLocal,
        }),
      )
      if (stageAction.type !== 'stage') throw new Error('expected stage')
      const stage: StageRecord = {
        round: r,
        agreed: stageAction.agreed,
        open: stageAction.open,
        ...(stageAction.nextFocus ? { nextFocus: stageAction.nextFocus } : {}),
        ...(stageAction.earlyExit ? { earlyExit: true } : {}),
        ...(stageAction.earlyExitReason
          ? { earlyExitReason: stageAction.earlyExitReason }
          : {}),
      }
      stages.push(stage)
      roundsRan = r
      emit({
        kind: 'roundtable.stage',
        round: r,
        agreed: stage.agreed,
        open: stage.open,
        ...(stage.earlyExit ? { earlyExit: true } : {}),
        ...(stage.earlyExitReason ? { earlyExitReason: stage.earlyExitReason } : {}),
        ...(stage.nextFocus ? { nextFocus: stage.nextFocus } : {}),
      })
      minutes = updateMinutes(minutes, r, roundLocal, stage)

      if (stage.earlyExit) {
        earlyExit = true
        break
      }
    }

    // ── Decide ──
    throwIfBudget()
    const decide = await chairOnce(
      'decide',
      chairUserForDecide({ issue: args.issue, minutes }),
    )
    if (decide.type !== 'decide') throw new Error('expected decide')
    emit({
      kind: 'roundtable.decide',
      decision: decide.decision,
      residual: decide.residual,
      nextSteps: decide.nextSteps,
    })
    emit({
      kind: 'roundtable.done',
      convened: true,
      advisorCalls,
      earlyExit,
    })

    return {
      phase: 'done',
      convened: true,
      markdown: markdown.trim() + '\n',
      advisorCalls,
      chairActions,
      earlyExit,
      roundsPlanned,
      roundsRan,
      ...edgeField(),
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    const aborted =
      signal.aborted ||
      (e instanceof Error && (e.name === 'AbortError' || e.message === 'aborted'))
    const budgetHit = reason.includes('wall-clock') || reason.includes('max chair')

    // If we already convened and have minutes, force a synthetic decide on budget errors.
    if (convened && budgetHit && !aborted && minutes.trim()) {
      const decision =
        lang === 'zh-CN' || lang === 'zh-TW'
          ? `（时间/步数预算用尽）基于已有讨论的临时结论：请优先处理未决议题。\n\n纪要摘要：\n${minutes.slice(0, 1200)}`
          : `(Budget exhausted.) Interim conclusion from discussion so far:\n\n${minutes.slice(0, 1200)}`
      emit({
        kind: 'roundtable.decide',
        decision,
        residual: ['Meeting ended early due to budget'],
        nextSteps: ['Review partial transcript', 'Re-run roundtable if needed'],
      })
      emit({
        kind: 'roundtable.done',
        convened: true,
        advisorCalls,
        earlyExit: true,
      })
      return {
        phase: 'done',
        convened: true,
        markdown: markdown.trim() + '\n',
        advisorCalls,
        chairActions,
        earlyExit: true,
        roundsPlanned,
        roundsRan,
        ...edgeField(),
      }
    }

    if (aborted) {
      emit({ kind: 'roundtable.aborted', reason: 'cancelled' })
      if (markdown.trim()) {
        const note =
          lang === 'zh-CN' || lang === 'zh-TW'
            ? '\n\n*(会议已取消；以上为已进行部分。)*\n'
            : '\n\n*(Meeting cancelled; partial transcript above.)*\n'
        markdown += note
        args.onMarkdownDelta?.(note)
      }
      return {
        phase: 'aborted',
        convened,
        markdown: markdown.trim() + '\n',
        advisorCalls,
        chairActions,
        earlyExit,
        roundsPlanned,
        roundsRan,
        abortReason: 'cancelled',
        ...edgeField(),
      }
    }
    // Best-effort decide note on hard failure if we already convened
    const failNote =
      lang === 'zh-CN' || lang === 'zh-TW'
        ? `\n\n*(圆桌引擎出错：${reason})*\n`
        : `\n\n*(Roundtable engine error: ${reason})*\n`
    markdown += failNote
    args.onMarkdownDelta?.(failNote)
    emit({ kind: 'roundtable.aborted', reason })
    return {
      phase: 'aborted',
      convened,
      markdown: markdown.trim() + '\n',
      advisorCalls,
      chairActions,
      earlyExit,
      roundsPlanned,
      roundsRan,
      abortReason: reason,
      ...edgeField(),
    }
  }
}
