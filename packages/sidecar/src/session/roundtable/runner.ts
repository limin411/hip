/**
 * Roundtable multi-round chair loop (docs/design/roundtable-loop.md).
 * L1/L2/L3 cast + verdict: docs/design/roundtable-dynamic-cast-verdict.md
 */
import {
  CHAIR_PARSE_RETRIES,
  MAX_ADVISOR_CALLS_PER_MEETING,
  MAX_ADVISORS_PER_ROUND,
  MAX_CHAIR_ACTIONS,
  ROUNDTABLE_COUNCIL_WALL_MS,
  ROUNDTABLE_ROUNDS_MAX,
  ROUNDTABLE_ROUNDS_MIN,
} from './constants.js'
import { resolveRoundtableLang } from './detect.js'
import { updateMinutes } from './minutes.js'
import { castIds, castSeatMap, defaultCastSeats, resolveCast } from './persona-briefs.js'
import {
  advisorSystemPrompt,
  advisorUserPrompt,
  chairSystemPrompt,
  chairUserForDecide,
  chairUserForDecideQualityRetry,
  chairUserForOpenRound,
  chairUserForPlan,
  chairUserForRoute,
  chairUserForStage,
  decideQualityFailures,
} from './prompts.js'
import { dedupeEdges, edgesFromEnvelope, type CouncilEdge } from './edges.js'
import { councilAgentId } from './ids.js'
import { renderEventMarkdown } from './render.js'
import { parseChairActionFromText } from './schema.js'
import { parseSpeechEnvelope } from './speech-schema.js'
import { pickReportSpeechContent } from './report-prose.js'
import type {
  CastSeat,
  ChairAction,
  DecidePayload,
  PersonaId,
  RunRoundtableArgs,
  RoundtableEvent,
  RoundtableReportPayload,
  RoundtableReportRound,
  RoundtableResult,
  SpeechRecord,
  StageRecord,
} from './types.js'

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const err = new Error('aborted')
    err.name = 'AbortError'
    throw err
  }
}

function toDecidePayload(d: Extract<ChairAction, { type: 'decide' }>): DecidePayload {
  return {
    verdict: d.verdict,
    decision: d.decision,
    keyTradeoffs: d.keyTradeoffs ?? [],
    residual: d.residual,
    nextSteps: d.nextSteps,
    ...(d.confidence ? { confidence: d.confidence } : {}),
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
  const councilMode = Boolean(args.councilMode || args.advisorHooks || args.runAdvisor)
  const wallClockMs =
    args.wallClockMs ?? (councilMode ? ROUNDTABLE_COUNCIL_WALL_MS : 180_000)
  const startedAt = Date.now()

  let advisorCalls = 0
  let chairActions = 0
  let minutes = ''
  let markdown = ''
  let convened = false
  let earlyExit = false
  let roundsPlanned: number | undefined
  let roundsRan = 0
  let planRationale = ''
  let planAgenda: string[] = []
  let meetingCast: CastSeat[] = defaultCastSeats(lang)
  const reportRounds: RoundtableReportRound[] = []
  let reportDecision: RoundtableReportPayload['decision']
  const stages: StageRecord[] = []
  const allEdges: CouncilEdge[] = []
  const edgeField = () => {
    const e = dedupeEdges(allEdges)
    return e.length ? { edges: e } : {}
  }
  const reportField = (): { report?: RoundtableReportPayload } => {
    if (!convened) return {}
    return {
      report: {
        issue: args.issue,
        agenda: planAgenda,
        rationale: planRationale,
        rounds: reportRounds,
        cast: meetingCast,
        ...(reportDecision ? { decision: reportDecision } : {}),
        ...(earlyExit ? { earlyExit: true } : {}),
      },
    }
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
    opts?: { softVerdict?: boolean },
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
        // Last retry for decide: soft-derive verdict so the meeting can finish.
        const softVerdict =
          opts?.softVerdict === true ||
          (allowed.has('decide') && attempt === CHAIR_PARSE_RETRIES)
        const action = parseChairActionFromText(text, { lang, softVerdict })
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

    // ── Plan (+ L3 cast) ──
    const plan = await chairOnce('plan', chairUserForPlan(args.issue, route.reason))
    if (plan.type !== 'plan') throw new Error('expected plan')
    let N = plan.rounds
    N = Math.min(roundsMax, Math.max(roundsMin, N)) as 2 | 3 | 4
    const agenda = plan.agenda.slice(0, N)
    while (agenda.length < N) agenda.push(`Round ${agenda.length + 1}`)
    roundsPlanned = N
    planAgenda = agenda
    planRationale = plan.rationale
    meetingCast = resolveCast(plan.cast, lang)
    const seatById = castSeatMap(meetingCast)
    const castIdList = castIds(meetingCast)

    emit({
      kind: 'roundtable.plan',
      rounds: N,
      agenda,
      rationale: plan.rationale,
      cast: meetingCast,
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
          cast: meetingCast,
        }),
      )
      if (open.type !== 'open_round') throw new Error('expected open_round')

      // Council: speak the meeting cast (not always hard-coded five).
      // Loop: honor chair speakers ∩ cast; empty → full cast.
      let speakers: PersonaId[]
      if (councilMode) {
        speakers = castIdList.slice(0, maxPerRound)
      } else {
        const filtered = open.speakers.filter((id) => seatById.has(id)).slice(0, maxPerRound)
        speakers = filtered.length ? filtered : castIdList.slice(0, maxPerRound)
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
        const seat = seatById.get(speaker) ?? meetingCast[0]!
        await args.advisorHooks?.onStart?.({
          speaker,
          round: r,
          focus: open.focus,
          agentId,
        })
        const promptCtx = {
          persona: speaker,
          lang,
          issue: args.issue,
          agenda,
          focus: open.focus,
          minutes,
          priorThisRound: prior,
          seat,
        }
        const system = advisorSystemPrompt(promptCtx)
        const user = advisorUserPrompt(promptCtx)
        const speech = args.runAdvisor
          ? await args.runAdvisor({
              speaker,
              system,
              user,
              signal,
              round: r,
              focus: open.focus,
              agentId,
              displayName: seat.title,
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
        const content = pickReportSpeechContent(raw, envelope.prose)
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
      reportRounds.push({
        round: r,
        focus: open.focus,
        speeches: roundLocal,
        stage,
      })
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

    // ── Decide (verdict + quality gate) ──
    throwIfBudget()
    let decide = await chairOnce(
      'decide',
      chairUserForDecide({ issue: args.issue, minutes, cast: meetingCast }),
    )
    if (decide.type !== 'decide') throw new Error('expected decide')

    let payload = toDecidePayload(decide)
    let fails = decideQualityFailures(payload)
    if (fails.length) {
      const retry = await chairOnce(
        'decide',
        chairUserForDecideQualityRetry({
          issue: args.issue,
          minutes,
          cast: meetingCast,
          failures: fails,
          priorJsonHint: JSON.stringify({
            verdict: payload.verdict,
            decision: payload.decision,
            keyTradeoffs: payload.keyTradeoffs,
            residual: payload.residual,
            nextSteps: payload.nextSteps,
          }),
        }),
        { softVerdict: true },
      )
      if (retry.type === 'decide') {
        const second = toDecidePayload(retry)
        const fails2 = decideQualityFailures(second)
        // Prefer second if it passes or is no worse on verdict length.
        if (!fails2.length || second.verdict.length >= payload.verdict.length) {
          payload = second
          fails = fails2
        }
      }
    }

    reportDecision = payload
    emit({
      kind: 'roundtable.decide',
      ...payload,
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
      ...reportField(),
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    const aborted =
      signal.aborted ||
      (e instanceof Error && (e.name === 'AbortError' || e.message === 'aborted'))
    const budgetHit = reason.includes('wall-clock') || reason.includes('max chair')

    if (convened && budgetHit && !aborted && minutes.trim()) {
      const verdict =
        lang === 'zh-CN' || lang === 'zh-TW'
          ? '（预算用尽）基于已有讨论的临时结论：优先处理未决议题。'
          : '(Budget exhausted.) Interim conclusion: prioritize unresolved open items.'
      const decision =
        lang === 'zh-CN' || lang === 'zh-TW'
          ? `（时间/步数预算用尽）基于已有讨论的临时结论：请优先处理未决议题。\n\n纪要摘要：\n${minutes.slice(0, 1200)}`
          : `(Budget exhausted.) Interim conclusion from discussion so far:\n\n${minutes.slice(0, 1200)}`
      const payload: DecidePayload = {
        verdict,
        decision,
        keyTradeoffs: [],
        residual: ['Meeting ended early due to budget'],
        nextSteps: ['Review partial transcript', 'Re-run roundtable if needed'],
      }
      reportDecision = payload
      earlyExit = true
      emit({
        kind: 'roundtable.decide',
        ...payload,
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
        ...reportField(),
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
        ...reportField(),
      }
    }
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
      ...reportField(),
    }
  }
}
