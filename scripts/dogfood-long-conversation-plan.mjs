#!/usr/bin/env node
/**
 * Dogfood harness for long-conversation + plan-mode checklist
 * (docs/design/2026-07-20-long-conversation-plan-mode-ux.md Manual dogfood).
 *
 * Pure-logic scenarios against sessionStore / helpers — no GUI / no paid LLM.
 *
 *   node --import tsx scripts/dogfood-long-conversation-plan.mjs
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const href = (rel) => pathToFileURL(path.join(root, rel)).href

const results = []
function pass(id, detail = '') {
  results.push({ id, ok: true, detail })
  console.log(`PASS  ${id}${detail ? ` — ${detail}` : ''}`)
}
function fail(id, detail) {
  results.push({ id, ok: false, detail: String(detail?.stack || detail) })
  console.log(`FAIL  ${id} — ${detail}`)
}

async function main() {
  const {
    applyServerMessage,
    lastAssistantIndex,
    isStreamingAssistant,
    isCurrentTurnAssistant,
    popForRegenerate,
    emptySession,
  } = await import(href('src/domain/sessionStore.ts'))
  const { hasPlanApproval } = await import(href('src/components/chat/planApproval.ts'))
  const { selectLivePlan, derivePlanUiPhase } = await import(href('src/lib/todos.ts'))
  const { StreamCoalescer } = await import(href('src/lib/streamCoalesce.ts'))
  const { TRANSCRIPT_WINDOW_SIZE, transcriptWindowStart } = await import(href('src/lib/transcriptWindow.ts'))
  const { contentFromTimeline } = await import(href('packages/sidecar/src/session/tool-trace.ts'))

  const sid = 'dogfood-sess'
  let now = 1_000_000
  let state = {
    sessions: [
      {
        ...emptySession(sid),
        config: {
          surface: 'code',
          llmProvider: 'openai',
          model: 'gpt-4o',
          tools: [],
          cwd: '/tmp/df',
        },
        loaded: true,
      },
    ],
  }

  const apply = (msg) => {
    now += 1
    state = applyServerMessage(state, msg, now)
    return state.sessions[0]
  }
  const session = () => state.sessions[0]
  const reset = (extra = {}) => {
    state = {
      sessions: [
        {
          ...emptySession(sid),
          config: {
            surface: 'code',
            llmProvider: 'openai',
            model: 'gpt-4o',
            tools: [],
            cwd: '/tmp/df',
          },
          loaded: true,
          ...extra,
        },
      ],
    }
  }

  // ── 1. 50+ turn transcript + window math ─────────────────────────────
  try {
    reset()
    const N = 55
    const msgs = []
    for (let i = 0; i < N; i++) {
      msgs.push({ id: `u-${i}`, role: 'user', content: `q${i}`, timestamp: i * 2 })
      msgs.push({
        id: `a-${i}`,
        role: 'assistant',
        content: `answer ${i}`,
        timestamp: i * 2 + 1,
        timeline: [{ kind: 'text', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: `answer ${i}` }],
      })
    }
    state.sessions[0] = { ...session(), messages: msgs }
    const total = session().messages.length
    if (total < N * 2) throw new Error(`messages=${total}`)
    const start = transcriptWindowStart(total, TRANSCRIPT_WINDOW_SIZE)
    const visible = total - start
    if (visible !== TRANSCRIPT_WINDOW_SIZE) {
      throw new Error(`window visible=${visible} want=${TRANSCRIPT_WINDOW_SIZE} start=${start} total=${total}`)
    }
    pass(
      'dogfood.long_conversation_50plus',
      `messages=${total} window=${TRANSCRIPT_WINDOW_SIZE} startIndex=${start}`,
    )
  } catch (e) {
    fail('dogfood.long_conversation_50plus', e)
  }

  // ── 2. Plan approval panel ready (non-empty) ─────────────────────────
  try {
    reset()
    const plan = [
      { id: '1', content: 'step one', status: 'pending' },
      { id: '2', content: 'step two', status: 'pending' },
    ]
    apply({ type: 'plan:published', sessionId: sid, turnId: 't1', plan })
    apply({
      type: 'agent:interrupt',
      sessionId: sid,
      turnId: 't1',
      question: 'Approve plan?',
      context: JSON.stringify({ kind: 'plan_approval', plan }),
    })
    const s = session()
    if (!hasPlanApproval(s)) throw new Error('hasPlanApproval=false')
    const live = selectLivePlan({
      messages: s.messages,
      status: s.status,
      forcePlan: !!s.config.forcePlan,
      planApprovalPending: s.planApprovalPending,
      activeTurnPlan: s.activeTurnPlan,
    })
    if (!live || live.phase !== 'awaiting_approval') throw new Error(`live=${JSON.stringify(live)}`)
    if (live.items.length !== 2) throw new Error(`items=${live.items.length}`)
    pass('dogfood.plan_approval_panel_ready', `phase=${live.phase} items=${live.items.length}`)
  } catch (e) {
    fail('dogfood.plan_approval_panel_ready', e)
  }

  // ── 3. Empty plan still awaiting (ExitPlanMode w/o write_todos) ───────
  try {
    reset()
    apply({ type: 'plan:published', sessionId: sid, turnId: 't-empty', plan: [] })
    apply({
      type: 'agent:interrupt',
      sessionId: sid,
      turnId: 't-empty',
      question: 'Approve empty plan?',
      context: JSON.stringify({ kind: 'plan_approval', plan: [] }),
    })
    const s = session()
    if (!hasPlanApproval(s)) throw new Error('empty plan not approval-pending')
    const live = selectLivePlan({
      messages: s.messages,
      status: s.status,
      forcePlan: false,
      planApprovalPending: true,
      activeTurnPlan: s.activeTurnPlan ?? [],
    })
    if (live?.phase !== 'awaiting_approval') throw new Error(`phase=${live?.phase}`)
    if (live.items.length !== 0) throw new Error(`items=${live.items.length}`)
    if (live.source !== 'empty') throw new Error(`source=${live.source}`)
    pass('dogfood.empty_plan_approval', `source=${live.source}`)
  } catch (e) {
    fail('dogfood.empty_plan_approval', e)
  }

  // ── 4. KD-7 complete keeps pending ───────────────────────────────────
  try {
    reset({ planApprovalPending: true, status: 'running' })
    apply({
      type: 'message:complete',
      sessionId: sid,
      message: {
        id: 't-complete',
        role: 'assistant',
        content: 'planned',
        timestamp: now,
      },
    })
    if (!session().planApprovalPending) throw new Error('complete cleared pending')
    pass('dogfood.complete_keeps_pending', 'KD-7')
  } catch (e) {
    fail('dogfood.complete_keeps_pending', e)
  }

  // ── 5. Notice preserves streaming on prior assistant ─────────────────
  try {
    reset({
      status: 'running',
      messages: [
        { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: 'partial', timestamp: 2, timeline: [] },
      ],
    })
    apply({
      type: 'agent:notification',
      sessionId: sid,
      taskId: 'bg1',
      description: 'research',
      status: 'completed',
    })
    const msgs = session().messages
    const last = msgs[msgs.length - 1]
    if (last.role !== 'notice') throw new Error(`last.role=${last.role}`)
    const idx = lastAssistantIndex(msgs)
    if (msgs[idx]?.id !== 'a1') throw new Error(`lastAssistant=${msgs[idx]?.id}`)
    if (!isStreamingAssistant(msgs, idx, 'running')) throw new Error('not streaming')
    if (!isCurrentTurnAssistant(msgs, idx)) throw new Error('not current turn assistant')
    pass('dogfood.notice_preserves_streaming', `notice=${last.id}`)
  } catch (e) {
    fail('dogfood.notice_preserves_streaming', e)
  }

  // ── 6. regenerate pops notice + assistant ────────────────────────────
  try {
    const next = popForRegenerate([
      { id: 'u1', role: 'user', content: 'q', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'a', timestamp: 2 },
      { id: 'n1', role: 'notice', content: 'note', timestamp: 3 },
    ])
    if (next.length !== 1 || next[0].role !== 'user') {
      throw new Error(JSON.stringify(next.map((m) => m.role)))
    }
    pass('dogfood.regenerate_pops_notice', '')
  } catch (e) {
    fail('dogfood.regenerate_pops_notice', e)
  }

  // ── 7. non-plan interrupt clears plan pending ────────────────────────
  try {
    reset({
      planApprovalPending: true,
      interrupt: { turnId: 't1', question: 'plan?', context: JSON.stringify({ kind: 'plan_approval' }) },
    })
    apply({
      type: 'agent:interrupt',
      sessionId: sid,
      turnId: 't1',
      question: 'Allow write_file?',
      context: JSON.stringify({ kind: 'permission', toolName: 'write_file' }),
    })
    if (session().planApprovalPending) throw new Error('pending still true')
    pass('dogfood.nonplan_interrupt_clears_pending', '')
  } catch (e) {
    fail('dogfood.nonplan_interrupt_clears_pending', e)
  }

  // ── 8. reject / resolved clears pending ──────────────────────────────
  try {
    reset({
      planApprovalPending: true,
      interrupt: { turnId: 't1', question: 'Approve?', context: JSON.stringify({ kind: 'plan_approval' }) },
    })
    apply({ type: 'agent:interrupt:resolved', sessionId: sid })
    if (session().planApprovalPending) throw new Error('pending still true after resolve')
    pass('dogfood.reject_resolved_clears', '')
  } catch (e) {
    fail('dogfood.reject_resolved_clears', e)
  }

  // ── 9. derivePlanUiPhase gold samples ────────────────────────────────
  try {
    const cases = [
      [{ forcePlan: true, planApprovalPending: false, status: 'running', activeTurnPlan: null }, 'planning'],
      [{ forcePlan: true, planApprovalPending: false, status: 'idle', activeTurnPlan: null }, 'off'],
      [
        {
          forcePlan: false,
          planApprovalPending: true,
          status: 'idle',
          activeTurnPlan: [],
          interruptContextKind: 'plan_approval',
        },
        'awaiting_approval',
      ],
      [{ forcePlan: false, planApprovalPending: false, status: 'idle', activeTurnPlan: null }, 'off'],
    ]
    for (const [input, want] of cases) {
      const got = derivePlanUiPhase(input)
      if (got !== want) throw new Error(`${JSON.stringify(input)} → ${got} (want ${want})`)
    }
    pass('dogfood.derivePlanUiPhase_gold', `${cases.length} rows`)
  } catch (e) {
    fail('dogfood.derivePlanUiPhase_gold', e)
  }

  // ── 10. StreamCoalescer stepSeq isolation ────────────────────────────
  try {
    const flushed = []
    // Defer schedule so same-stepSeq deltas merge before flushAll.
    let scheduledCb = null
    const c = new StreamCoalescer(
      (b) => flushed.push({ kind: b.kind, stepSeq: b.stepSeq, text: b.text }),
      (cb) => {
        scheduledCb = cb
        return () => {
          scheduledCb = null
        }
      },
    )
    c.push({
      sessionId: sid,
      turnId: 't1',
      agentId: 'supervisor',
      kind: 'text',
      stepSeq: 1,
      delta: 'A',
    })
    c.push({
      sessionId: sid,
      turnId: 't1',
      agentId: 'supervisor',
      kind: 'text',
      stepSeq: 1,
      delta: 'B',
    })
    c.push({
      sessionId: sid,
      turnId: 't1',
      agentId: 'supervisor',
      kind: 'text',
      stepSeq: 2,
      delta: 'C',
    })
    c.flushAll()
    const bySeq = Object.fromEntries(flushed.map((f) => [f.stepSeq, f.text]))
    if (bySeq[1] !== 'AB') throw new Error(`seq1=${bySeq[1]}`)
    if (bySeq[2] !== 'C') throw new Error(`seq2=${bySeq[2]}`)
    if (flushed.length !== 2) throw new Error(`flushed=${flushed.length}`)
    pass('dogfood.stream_coalesce_keys', 'stepSeq isolation + merge')
  } catch (e) {
    fail('dogfood.stream_coalesce_keys', e)
  }

  // ── 11. contentFromTimeline supervisor-only ──────────────────────────
  try {
    const content = contentFromTimeline([
      { kind: 'text', stepSeq: 2, agentId: 'supervisor', role: 'supervisor', content: 'B' },
      { kind: 'tool', stepSeq: 1, agentId: 'supervisor', role: 'supervisor', callId: 'c1' },
      { kind: 'text', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'A' },
      { kind: 'text', stepSeq: 3, agentId: 'worker', role: 'coder', content: 'NOPE' },
    ])
    if (content !== 'AB') throw new Error(JSON.stringify(content))
    pass('dogfood.contentFromTimeline_supervisor_only', content)
  } catch (e) {
    fail('dogfood.contentFromTimeline_supervisor_only', e)
  }

  // ── 12. live text↔tool interleave via token:stream.stepSeq ───────────
  try {
    reset({
      status: 'running',
      messages: [
        {
          id: 'turn-live',
          role: 'assistant',
          content: '',
          timestamp: 1,
          timeline: [],
          toolCalls: [],
          agentRuns: [{ agentId: 'supervisor', role: 'supervisor', output: '', startedAt: 1, seq: 0 }],
        },
      ],
    })
    apply({
      type: 'token:stream',
      sessionId: sid,
      turnId: 'turn-live',
      agentId: 'supervisor',
      delta: 'Hello',
      stepSeq: 0,
      role: 'supervisor',
    })
    apply({
      type: 'token:stream',
      sessionId: sid,
      turnId: 'turn-live',
      agentId: 'supervisor',
      delta: ' world',
      stepSeq: 0,
      role: 'supervisor',
    })
    apply({
      type: 'tool:started',
      sessionId: sid,
      turnId: 'turn-live',
      agentId: 'supervisor',
      role: 'supervisor',
      callId: 'c1',
      name: 'read_file',
      input: '{}',
      seq: 1,
    })
    apply({
      type: 'token:stream',
      sessionId: sid,
      turnId: 'turn-live',
      agentId: 'supervisor',
      delta: 'After',
      stepSeq: 2,
      role: 'supervisor',
    })
    const m = session().messages.find((x) => x.id === 'turn-live')
    if (!m?.content.includes('Hello world') || !m.content.includes('After')) {
      throw new Error(`content=${JSON.stringify(m?.content)}`)
    }
    const textSteps = (m.timeline || []).filter((t) => t.kind === 'text')
    if (textSteps.length < 2) throw new Error(`textSteps=${textSteps.length}`)
    if (!(textSteps[0].stepSeq < textSteps[1].stepSeq)) throw new Error('stepSeq order')
    const tools = (m.timeline || []).filter((t) => t.kind === 'tool')
    if (tools.length !== 1 || tools[0].stepSeq !== 1) throw new Error(`tools=${JSON.stringify(tools)}`)
    pass('dogfood.live_text_tool_interleave', `texts=${textSteps.length} content=${m.content}`)
  } catch (e) {
    fail('dogfood.live_text_tool_interleave', e)
  }

  // ── 13. subagent token → run.output only ─────────────────────────────
  try {
    reset({
      status: 'running',
      messages: [
        {
          id: 'turn-sub',
          role: 'assistant',
          content: 'sup',
          timestamp: 1,
          timeline: [],
          toolCalls: [],
          agentRuns: [{ agentId: 'worker-1', role: 'coder', output: '', startedAt: 1, seq: 0 }],
        },
      ],
    })
    apply({
      type: 'token:stream',
      sessionId: sid,
      turnId: 'turn-sub',
      agentId: 'worker-1',
      delta: 'sub text',
    })
    const m = session().messages.find((x) => x.id === 'turn-sub')
    const textSteps = (m.timeline || []).filter((t) => t.kind === 'text')
    if (textSteps.length !== 0) throw new Error(`textSteps=${textSteps.length}`)
    const run = m.agentRuns?.find((r) => r.agentId === 'worker-1')
    if (!run?.output?.includes('sub text')) throw new Error(`output=${run?.output}`)
    if (m.content.includes('sub text')) throw new Error('leaked into content')
    pass('dogfood.subagent_no_text_steps', `output=${run.output}`)
  } catch (e) {
    fail('dogfood.subagent_no_text_steps', e)
  }

  // ── 14. plan:respond:result ok:false restores pending ────────────────
  try {
    reset({
      planApprovalPending: false,
      status: 'running',
      planRespondRollback: {
        interrupt: {
          turnId: 't1',
          question: 'Approve?',
          context: JSON.stringify({ kind: 'plan_approval' }),
        },
        status: 'idle',
      },
    })
    apply({
      type: 'plan:respond:result',
      sessionId: sid,
      ok: false,
      error: 'not_awaiting',
    })
    if (!session().planApprovalPending) throw new Error('pending not restored')
    pass('dogfood.plan_respond_result_rollback', 'KD-16')
  } catch (e) {
    fail('dogfood.plan_respond_result_rollback', e)
  }

  // ── 15. resync after session:loaded (D4c.1) ──────────────────────────
  try {
    const { emitPlanApprovalResync } = await import(href('packages/sidecar/src/session/plan-approval-resync.ts'))
    reset({
      planApprovalPending: true,
      activeTurnPlan: [{ content: 'old', status: 'pending' }],
      interrupt: { turnId: 't0', question: 'old', context: JSON.stringify({ kind: 'plan_approval' }) },
    })
    apply({
      type: 'session:loaded',
      sessionId: sid,
      messages: [{ id: 'a1', role: 'assistant', content: 'planned', timestamp: 1 }],
      config: { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], surface: 'code' },
    })
    if (session().planApprovalPending) throw new Error('session:loaded should clear pending')
    const packets = []
    emitPlanApprovalResync((m) => packets.push(m), sid, {
      turnId: 't-resync',
      plan: [{ content: 'resync step', status: 'pending' }],
      question: 'Approve this plan?',
    })
    for (const m of packets) apply(m)
    if (!hasPlanApproval(session())) throw new Error('resync did not restore pending')
    const live = selectLivePlan({
      messages: session().messages,
      status: session().status,
      forcePlan: false,
      planApprovalPending: true,
      activeTurnPlan: session().activeTurnPlan,
    })
    if (live?.phase !== 'awaiting_approval') throw new Error(`phase=${live?.phase}`)
    if (live.items[0]?.content !== 'resync step') throw new Error(JSON.stringify(live.items))
    pass('dogfood.resync_after_session_loaded', 'D4c.1')
  } catch (e) {
    fail('dogfood.resync_after_session_loaded', e)
  }

  const failed = results.filter((r) => !r.ok)
  const ok = results.filter((r) => r.ok)
  console.log('')
  console.log(`summary: ok=${failed.length === 0} passed=${ok.length} failed=${failed.length}`)
  console.log(JSON.stringify({ ok: failed.length === 0, passed: ok.length, failed: failed.length, results }))
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
