// src/domain/e2eHooks.ts
// E2E / DEV harness hooks, extracted from SessionService (P1, spec 2026-08-07).
// Dev-only: installE2eHooks is guarded by import.meta.env.PROD; production app
// builds never expose the inject surface. The session facade forwards its
// simulate*/seed* methods here so tests and e2e keep the same calling surface.
import type {
  MemoryFileConfig,
  MemoryItem,
  MemoryScope,
  MemoryStatus,
  ServerMessage,
} from '@hip/protocol'
import { nanoid } from 'nanoid'
import { useDomainStore, DEFAULT_CONFIG } from './sessionStore'
import type { SessionService } from './sessionService'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import {
  formatDiffAnnotationsForComposer,
  useDiffAnnotationStore,
} from '@/store/diffAnnotationStore'
import { useFocusStore } from '@/store/focusStore'
import { useFsStore } from '@/store/fsStore'
import { useGoalStore } from '@/store/goalStore'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useProvidersStore } from '@/store/providersStore'
import { useUiStore } from '@/store/uiStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { KNOWLEDGE_LIVE_FLAG_KEY } from '@/domain/knowledge/editorMode'
import { resolveModelConfig } from '@/lib/modelKey'

/**
 * FE-only plan approval seeds (seedPlanApproval) never pause the sidecar.
 * Track them so respondPlan completes locally with plan:respond:result ok:true
 * instead of plan:respond → not_awaiting → KD-16 rollback (card reappears).
 * Module-level so both the facade (respondPlan) and the hooks share it without
 * a circular dependency.
 */
const feOnlyPlanApprovalSessions = new Set<string>()

export function markFeOnlyPlanApproval(sessionId: string): void {
  feOnlyPlanApprovalSessions.add(sessionId)
}

export function unmarkFeOnlyPlanApproval(sessionId: string): void {
  feOnlyPlanApprovalSessions.delete(sessionId)
}

export function isFeOnlyPlanApproval(sessionId: string): boolean {
  return feOnlyPlanApprovalSessions.has(sessionId)
}

/** Matches packages/sidecar `SUBAGENT_PAUSE_MARKER` (Track B). */
export const SUBAGENT_PAUSE_MARKER = '[hip:subagent_paused]' as const

/**
 * E2E simulation hooks — never used by production UI paths. The facade forwards
 * its simulate and seed methods here so callers (tests, e2e) keep the same surface.
 */
export class E2eHooks {
  constructor(private readonly svc: SessionService) {}

  /**
   * E2E: snapshot workflow store for a session (product has no dedicated DAG shell).
   */
  getWorkflowSession(sessionId: string): {
    activeWorkflow: { id: string; name: string } | null
    runId: string | null
    runStatus: string | null
    nodeStatuses: Record<string, string>
  } {
    const slice = useWorkflowStore.getState().getSession(sessionId)
    const def = slice.activeWorkflow
    const nodes = slice.runState?.nodes ?? {}
    const nodeStatuses: Record<string, string> = {}
    for (const [nid, n] of Object.entries(nodes)) {
      nodeStatuses[nid] = n.status
    }
    return {
      activeWorkflow: def ? { id: def.id, name: def.name } : null,
      runId: slice.runId,
      runStatus: slice.runState?.status ?? null,
      nodeStatuses,
    }
  }

  /**
   * Seed an in-flight write_file toolCall and emit tool:finished so the
   * Sprint B diff-refresh path runs (debounced requestDiff). E2E uses this
   * after writing the file on disk without a real LLM turn.
   */
  simulateAgentWriteFinished(
    sessionId: string,
    opts?: { path?: string },
  ): { turnId: string; callId: string } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const callId = `e2e-write-${nanoid(8)}`
    const filePath = opts?.path ?? '/README.md'
    const now = Date.now()
    useDomainStore.setState((st) => ({
      ...st,
      sessions: st.sessions.map((s) =>
        s.id !== sessionId
          ? s
          : {
              ...s,
              status: 'running' as const,
              messages: [
                ...s.messages,
                {
                  id: turnId,
                  role: 'assistant' as const,
                  content: '',
                  timestamp: now,
                  toolCalls: [
                    {
                      callId,
                      agentId: 'coder',
                      name: 'write_file',
                      input: JSON.stringify({ path: filePath, content: 'e2e' }),
                      status: 'running' as const,
                      seq: 1,
                    },
                  ],
                  timeline: [
                    {
                      kind: 'tool' as const,
                      stepSeq: 1,
                      agentId: 'coder',
                      role: 'coder' as const,
                      callId,
                    },
                  ],
                },
              ],
            },
      ),
    }))
    this.svc.injectServerMessage({
      type: 'tool:finished',
      sessionId,
      turnId,
      agentId: 'coder',
      callId,
      status: 'finished',
      output: `wrote ${filePath}`,
    })
    // Ensure Changes refresh is not lost if debounce is cancelled mid-test.
    this.svc.requestDiff(sessionId)
    return { turnId, callId }
  }

  /**
   * E2E: seed a finished edit_file tool with unified-diff-shaped output so
   * ToolCallRow renders tool-inline-diff (P2).
   */
  simulateEditWithDiff(
    sessionId: string,
    opts?: { path?: string },
  ): { turnId: string; callId: string } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const callId = `e2e-edit-${nanoid(8)}`
    const filePath = opts?.path ?? '/README.md'
    const now = Date.now()
    const diffOut = `@@ -1 +1 @@\n-a\n+b\nedited ${filePath}`
    useDomainStore.setState((st) => ({
      ...st,
      sessions: st.sessions.map((s) =>
        s.id !== sessionId
          ? s
          : {
              ...s,
              status: 'running' as const,
              messages: [
                ...s.messages,
                {
                  id: turnId,
                  role: 'assistant' as const,
                  content: '',
                  timestamp: now,
                  agentRuns: [
                    {
                      agentId: 'supervisor',
                      role: 'supervisor' as const,
                      output: '',
                      startedAt: now,
                      finishedAt: null,
                      seq: 0,
                      messageId: turnId,
                    },
                  ],
                  toolCalls: [
                    {
                      callId,
                      agentId: 'supervisor',
                      name: 'edit_file',
                      input: JSON.stringify({ path: filePath, oldString: 'a', newString: 'b' }),
                      status: 'finished' as const,
                      output: diffOut,
                      seq: 1,
                    },
                  ],
                  timeline: [
                    {
                      kind: 'tool' as const,
                      stepSeq: 1,
                      agentId: 'supervisor',
                      role: 'supervisor' as const,
                      callId,
                    },
                  ],
                },
              ],
            },
      ),
    }))
    return { turnId, callId }
  }

  /** E2E: seed a running tool card on the active turn for process-UI assertions. */
  simulateToolStarted(
    sessionId: string,
    opts?: { name?: string; path?: string },
  ): { turnId: string; callId: string } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const callId = `e2e-tool-${nanoid(8)}`
    const name = opts?.name ?? 'read_file'
    const filePath = opts?.path ?? '/README.md'
    const now = Date.now()
    useDomainStore.setState((st) => ({
      ...st,
      sessions: st.sessions.map((s) =>
        s.id !== sessionId
          ? s
          : {
              ...s,
              status: 'running' as const,
              messages: [
                ...s.messages,
                {
                  id: turnId,
                  role: 'assistant' as const,
                  content: '',
                  timestamp: now,
                  agentRuns: [
                    {
                      agentId: 'supervisor',
                      role: 'supervisor' as const,
                      output: '',
                      startedAt: now,
                      finishedAt: null,
                      seq: 0,
                      messageId: turnId,
                    },
                  ],
                  toolCalls: [
                    {
                      callId,
                      agentId: 'supervisor',
                      name,
                      input: JSON.stringify({ path: filePath }),
                      status: 'running' as const,
                      seq: 1,
                    },
                  ],
                  timeline: [
                    {
                      kind: 'tool' as const,
                      stepSeq: 1,
                      agentId: 'supervisor',
                      role: 'supervisor' as const,
                      callId,
                    },
                  ],
                },
              ],
            },
      ),
    }))
    return { turnId, callId }
  }

  /** E2E: create a chat session without sending a user message (no LLM turn). */
  createChatSessionForE2e(): string {
    const id = this.svc.createSession({ ...DEFAULT_CONFIG, surface: 'chat' })
    // selectSession sets activeView to chat so ChatPane is the visible shell.
    this.svc.selectSession(id)
    return id
  }

  /** E2E: create a code session bound to cwd without an LLM turn. */
  createCodeSessionForE2e(cwd: string): string {
    const id = this.svc.createSession({
      ...DEFAULT_CONFIG,
      surface: 'code',
      cwd,
      permissionMode: 'edit',
    })
    this.svc.selectSession(id)
    // Ensure code panel is open so Files/Agents/Changes tabs exist for e2e.
    useDomainStore.getState().setSessionCodePanelOpen(id, true)
    return id
  }

  /**
   * E2E H2: put session into running with partial assistant text + in-flight tool
   * so Stop shows and CANCELLED keeps a non-empty stopped projection.
   */
  simulateTurnRunning(sessionId: string): { turnId: string; callId: string } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const callId = `e2e-call-${nanoid(8)}`
    this.svc.injectServerMessage({
      type: 'agent:started',
      sessionId,
      turnId,
      agentId: 'supervisor',
      role: 'supervisor',
    })
    this.svc.injectServerMessage({
      type: 'token:stream',
      sessionId,
      turnId,
      agentId: 'supervisor',
      delta: 'partial e2e reply',
    })
    // Running tool makes finalizeCancelledMessage treat the turn as in-flight (sets stopped).
    this.svc.injectServerMessage({
      type: 'tool:started',
      sessionId,
      turnId,
      agentId: 'supervisor',
      role: 'supervisor',
      callId,
      name: 'read_file',
      input: '{}',
      seq: 1,
    })
    return { turnId, callId }
  }

  /** E2E H2: apply CANCELLED projection (same path as sidecar cancel). */
  simulateTurnCancelled(sessionId: string): void {
    this.svc.injectServerMessage({ type: 'error', sessionId, code: 'CANCELLED', message: 'cancelled' })
  }

  /** E2E H4: surface inline error so copy-debug is available. */
  simulateSessionError(
    sessionId: string,
    code = 'AGENT_ERROR',
    message = 'e2e simulated error',
  ): void {
    this.svc.injectServerMessage({ type: 'error', sessionId, code, message })
  }

  /**
   * E2E H6: seed supervisor + coder sub-agent so Agents panel shows structure
   * and cards without a real LLM turn.
   */
  seedAgentCollaboration(sessionId: string): { turnId: string; callId: string } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const callId = `e2e-call-${nanoid(8)}`
    this.svc.injectServerMessage({
      type: 'agent:started',
      sessionId,
      turnId,
      agentId: 'supervisor',
      role: 'supervisor',
    })
    this.svc.injectServerMessage({
      type: 'agent:started',
      sessionId,
      turnId,
      agentId: 'coder-1',
      role: 'coder',
      parentAgentId: 'supervisor',
      taskInput: 'e2e implement feature',
    })
    this.svc.injectServerMessage({
      type: 'tool:started',
      sessionId,
      turnId,
      agentId: 'coder-1',
      role: 'coder',
      callId,
      name: 'read_file',
      input: '{"path":"README.md"}',
      seq: 1,
    })
    return { turnId, callId }
  }

  /** E2E H4: same redacted JSON builder as ChatPane copy-debug (avoids clipboard flake). */
  /** E2E H5: surface HITL permission modal. */
  simulatePermissionRequest(sessionId: string): { turnId: string; requestId: string } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const requestId = `e2e-perm-${nanoid(8)}`
    this.svc.injectServerMessage({
      type: 'permission:request',
      sessionId,
      turnId,
      requestId,
      tool: { title: 'e2e-run-script', kind: 'execute', content: 'echo e2e' },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
      ],
    })
    return { turnId, requestId }
  }

  /**
   * E2E multi-track B: project subagent pause handoff (first-line marker, not Error:).
   * Mirrors sidecar `formatPausedToolResult` wire format without a real LLM/task tool.
   */
  seedSubagentPause(sessionId: string): {
    turnId: string
    callId: string
    marker: typeof SUBAGENT_PAUSE_MARKER
  } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const callId = `e2e-task-${nanoid(8)}`
    const childCallId = `e2e-child-${nanoid(8)}`
    const marker = SUBAGENT_PAUSE_MARKER
    const question = 'Which API should we target?'
    const output = `${marker} ${question}\npartial subagent progress`
    this.svc.injectServerMessage({
      type: 'agent:started',
      sessionId,
      turnId,
      agentId: 'supervisor',
      role: 'supervisor',
    })
    this.svc.injectServerMessage({
      type: 'agent:started',
      sessionId,
      turnId,
      agentId: 'coder-1',
      role: 'coder',
      parentAgentId: 'supervisor',
      taskInput: 'e2e implement feature',
    })
    // Parent task tool (row suppressed in TurnTimeline; result carries pause marker).
    this.svc.injectServerMessage({
      type: 'tool:started',
      sessionId,
      turnId,
      agentId: 'supervisor',
      role: 'supervisor',
      callId,
      name: 'task',
      input: JSON.stringify({ description: 'e2e implement feature', prompt: 'do the work' }),
      seq: 1,
    })
    // Child timeline step so delegation-row can bind taskInput (same pattern as seedAgentCollaboration).
    this.svc.injectServerMessage({
      type: 'tool:started',
      sessionId,
      turnId,
      agentId: 'coder-1',
      role: 'coder',
      callId: childCallId,
      name: 'read_file',
      input: '{"path":"README.md"}',
      seq: 2,
    })
    // Wire: task finishes with pause marker in output (not Error: prefix; not tool failure streak).
    this.svc.injectServerMessage({
      type: 'tool:finished',
      sessionId,
      turnId,
      agentId: 'supervisor',
      callId,
      status: 'finished',
      output,
    })
    this.svc.injectServerMessage({
      type: 'token:stream',
      sessionId,
      turnId,
      agentId: 'supervisor',
      delta: `${marker} ${question}`,
    })
    // Seed helpers are synchronous fixtures — drain coalesced tokens so probes/UI see content immediately.
    this.svc.flushCoalescedForE2e(sessionId, turnId)
    return { turnId, callId, marker }
  }

  /** E2E: supervisor agent:interrupt HITL question banner. */
  seedAgentInterrupt(sessionId: string, question = 'How should I proceed with the e2e task?'): {
    turnId: string
    question: string
  } {
    const turnId = `e2e-turn-${nanoid(8)}`
    this.svc.injectServerMessage({
      type: 'agent:started',
      sessionId,
      turnId,
      agentId: 'supervisor',
      role: 'supervisor',
    })
    this.svc.injectServerMessage({
      type: 'token:stream',
      sessionId,
      turnId,
      agentId: 'supervisor',
      delta: 'Need clarification before continuing.',
    })
    this.svc.injectServerMessage({
      type: 'agent:interrupt',
      sessionId,
      turnId,
      agentId: 'supervisor',
      question,
    })
    return { turnId, question }
  }

  /** E2E: plan:published + plan_approval interrupt → PlanApprovalCard / PlanProgressPanel. */
  seedPlanApproval(
    sessionId: string,
    opts?: { markdown?: string; planPath?: string },
  ): {
    turnId: string
    planItems: { content: string; status: string }[]
    markdown: string
  } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const planItems = [
      { content: 'e2e plan step one', status: 'pending' as const },
      { content: 'e2e plan step two', status: 'pending' as const },
    ]
    const markdown =
      opts?.markdown ??
      '## E2E plan\n\nSeeded plan body for sticky markdown preview.\n\n- step one\n- step two\n'
    const planPath = opts?.planPath ?? `/tmp/hip-e2e/plans/${sessionId}.md`
    this.svc.injectServerMessage({
      type: 'agent:started',
      sessionId,
      turnId,
      agentId: 'supervisor',
      role: 'supervisor',
    })
    this.svc.injectServerMessage({
      type: 'plan:published',
      sessionId,
      turnId,
      plan: planItems,
      markdown,
      planPath,
      markdownTruncated: false,
    })
    this.svc.injectServerMessage({
      type: 'agent:interrupt',
      sessionId,
      turnId,
      agentId: 'supervisor',
      question: 'plan_approval',
      context: JSON.stringify({ kind: 'plan_approval' }),
    })
    // Sidecar is not paused — respondPlan must not wait on plan:respond wire.
    markFeOnlyPlanApproval(sessionId)
    return { turnId, planItems, markdown }
  }

  /**
   * E2E: agent:started + plan:updated (no approval) → sticky PlanProgressPanel with progress.
   * Optional message:complete to assert done-state retention of activeTurnPlan.
   */
  seedPlanProgress(
    sessionId: string,
    opts?: { complete?: boolean },
  ): {
    turnId: string
    planItems: { content: string; status: string }[]
  } {
    const turnId = `e2e-turn-${nanoid(8)}`
    const planItems = [
      { content: 'e2e progress step one', status: 'completed' as const },
      { content: 'e2e progress step two', status: 'in_progress' as const },
      { content: 'e2e progress step three', status: 'pending' as const },
    ]
    this.svc.injectServerMessage({
      type: 'agent:started',
      sessionId,
      turnId,
      agentId: 'supervisor',
      role: 'supervisor',
    })
    this.svc.injectServerMessage({
      type: 'plan:updated',
      sessionId,
      turnId,
      plan: planItems,
    })
    if (opts?.complete) {
      this.svc.injectServerMessage({
        type: 'message:complete',
        sessionId,
        message: {
          id: turnId,
          role: 'assistant',
          content: 'e2e plan progress complete',
          timestamp: Date.now(),
          agentId: 'supervisor',
        },
      })
    }
    return { turnId, planItems }
  }

  /** E2E: background task killed notification (synthetic notice message). */
  seedBackgroundTaskKilled(sessionId: string): {
    turnId: string
    agentId: string
    taskId: string
  } {
    const taskId = `e2e-bg-${nanoid(8)}`
    this.svc.injectServerMessage({
      type: 'agent:notification',
      sessionId,
      taskId,
      description: 'e2e background job',
      status: 'killed',
      error: 'killed by user: cancel',
    })
    const sess = useDomainStore.getState().sessions.find((s) => s.id === sessionId)
    const notice = [...(sess?.messages ?? [])].reverse().find((m) => m.role === 'notice' && m.id.startsWith(`notif-${taskId}-`))
    return { turnId: notice?.id ?? `notif-${taskId}`, agentId: taskId, taskId }
  }

  /** E2E: seed a running Runtime task so the composer runtime strip shows it. */
  seedRuntimeTask(sessionId: string, opts: { kind?: 'shell' | 'agent' | 'monitor' | 'schedule'; status?: 'running' | 'scheduled' | 'completed'; description?: string } = {}): {
    taskId: string
  } {
    const taskId = `e2e-rt-${nanoid(8)}`
    const kind = opts.kind ?? 'shell'
    const status = opts.status ?? 'running'
    const now = Date.now()
    this.svc.injectServerMessage({
      type: 'task:snapshot',
      sessionId,
      tasks: [
        {
          id: taskId,
          kind,
          description: opts.description ?? `e2e ${kind} task`,
          status,
          createdAt: now,
          updatedAt: now,
        },
      ],
      runningCounts: {
        shell: kind === 'shell' && status === 'running' ? 1 : 0,
        agent: kind === 'agent' && status === 'running' ? 1 : 0,
        monitor: kind === 'monitor' && status === 'running' ? 1 : 0,
        schedule: status === 'scheduled' ? 1 : 0,
      },
    })
    return { taskId }
  }

  /** E2E: sidecar rejected workflow def (INVALID_WORKFLOW) error projection. */
  simulateInvalidWorkflowError(
    sessionId: string,
    reason = 'workflow nodes of type tool|human are not supported',
  ): void {
    this.svc.injectServerMessage({
      type: 'error',
      sessionId,
      code: 'INVALID_WORKFLOW',
      message: reason,
    })
  }

  /** E2E probe: last assistant message text (pause marker / notification). */
  getLastAssistantText(sessionId: string): string | null {
    const sess = useDomainStore.getState().sessions.find((s) => s.id === sessionId)
    if (!sess) return null
    for (let i = sess.messages.length - 1; i >= 0; i--) {
      const m = sess.messages[i]
      if (m.role === 'assistant') return m.content ?? ''
    }
    return null
  }

  /** E2E probe: pending interrupt question. */
  getPendingInterrupt(sessionId: string): { turnId: string; question: string } | null {
    const sess = useDomainStore.getState().sessions.find((s) => s.id === sessionId)
    const i = sess?.interrupt
    if (!i) return null
    return { turnId: i.turnId, question: i.question }
  }

  /**
   * E2E S5: open global command palette (⌘K) without OS key routing.
   */
  openCommandPaletteForE2e(): void {
    useCommandPaletteStore.getState().setOpen(true)
  }

  closeCommandPaletteForE2e(): void {
    useCommandPaletteStore.getState().close()
  }

  /**
   * E2E: jump to Settings on a given nav page via uiStore (same path as SettingsPanel tabs).
   * Prefer this over account-menu + Radix nav when residual suite state is flaky.
   */
  openSettingsPageForE2e(page = 'general'): void {
    // Same store path as openSettingsOverlay (page always wins).
    useUiStore.getState().setSettingsPage(page as import('@/store/uiStore').SettingsPageId)
    useUiStore.getState().setOverlay('settings')
  }

  /** E2E: open Session History overlay shell. */
  openHistoryPageForE2e(): void {
    useUiStore.getState().setOverlay('history')
  }

  /** E2E: open product Recycle Bin overlay shell. */
  openTrashPageForE2e(): void {
    useUiStore.getState().setOverlay('trash')
    this.svc.requestTrashList()
  }

  /** E2E: close any footer utility overlay shell. */
  closeOverlayForE2e(): void {
    useUiStore.getState().setOverlay(null)
  }

  /** E2E T2: install failure payload (UI must have submitted form to show error). */
  simulatePluginInstallError(error = 'e2e package structure invalid'): void {
    this.svc.injectServerMessage({ type: 'plugin:install:result', ok: false, error })
  }

}

/** E2E bridge: only installed outside production builds (vite DEV / e2e). */
export type HipE2EHooks = {
  injectServerMessage: (msg: ServerMessage) => void
  simulateAgentWriteFinished: (
    sessionId: string,
    opts?: { path?: string },
  ) => { turnId: string; callId: string }
  simulateToolStarted: (
    sessionId: string,
    opts?: { name?: string; path?: string },
  ) => { turnId: string; callId: string }
  simulateEditWithDiff: (
    sessionId: string,
    opts?: { path?: string },
  ) => { turnId: string; callId: string }
  getActiveSessionId: () => string | null
  createChatSessionForE2e: () => string
  createCodeSessionForE2e: (cwd: string) => string
  simulateTurnRunning: (sessionId: string) => { turnId: string; callId: string }
  simulateTurnCancelled: (sessionId: string) => void
  simulateSessionError: (sessionId: string, code?: string, message?: string) => void
  seedAgentCollaboration: (sessionId: string) => { turnId: string; callId: string }
  getSessionDebugBundleJson: () => string | null
  simulatePermissionRequest: (sessionId: string) => { turnId: string; requestId: string }
  openCommandPaletteForE2e: () => void
  closeCommandPaletteForE2e: () => void
  /** E2E: open Settings on a nav page via store (avoids Radix menu flakes). */
  openSettingsPageForE2e: (page?: string) => void
  /** E2E: open Session History via store. */
  openHistoryPageForE2e: () => void
  /** E2E: open Recycle Bin via store. */
  openTrashPageForE2e: () => void
  /** E2E: close any footer utility overlay. */
  closeOverlayForE2e: () => void
  simulatePluginInstallError: (error?: string) => void
  /** Cross-session memory (WS via SessionService). */
  getMemoryConfig: () => Promise<MemoryFileConfig>
  setMemoryConfig: (partial: Partial<MemoryFileConfig>) => Promise<MemoryFileConfig>
  seedMemoryItem: (
    item: Partial<MemoryItem> & Pick<MemoryItem, 'title' | 'content' | 'kind' | 'scope'>,
  ) => Promise<MemoryItem>
  listMemories: (filter?: {
    scope?: MemoryScope
    projectKeyHash?: string
    sessionId?: string
    query?: string
    limit?: number
    status?: MemoryStatus
  }) => Promise<MemoryItem[]>
  deleteMemory: (id: string, hard?: boolean) => Promise<boolean>
  restoreMemory: (id: string) => Promise<MemoryItem>
  emptyMemoryTrash: () => Promise<number>
  triggerMemoryConsolidate: (projectKeyHash?: string) => void
  getActiveSessionMemoryFlags: () => {
    useMemories?: boolean
    generateMemories?: boolean
    incognito?: boolean
  } | null
  getActiveSessionForcePlan: () => boolean | null
  /** E2E: read workflow store projection (product path has no dedicated DAG shell). */
  getWorkflowSession: (sessionId: string) => {
    activeWorkflow: { id: string; name: string } | null
    runId: string | null
    runStatus: string | null
    nodeStatuses: Record<string, string>
  }
  seedSubagentPause: (sessionId: string) => {
    turnId: string
    callId: string
    marker: '[hip:subagent_paused]'
  }
  seedAgentInterrupt: (sessionId: string, question?: string) => { turnId: string; question: string }
  seedPlanApproval: (sessionId: string) => {
    turnId: string
    planItems: { content: string; status: string }[]
  }
  seedPlanProgress: (
    sessionId: string,
    opts?: { complete?: boolean },
  ) => {
    turnId: string
    planItems: { content: string; status: string }[]
  }
  /** Switch global active model (DeepSeek dogfood). */
  setActiveModel: (providerID: string, modelID: string, baseURL?: string) => void
  /** Reload session history from sidecar (triggers plan-approval resync D4c.1). */
  reloadSession: (sessionId: string) => void
  /** Whether FE has planApprovalPending for a session. */
  getPlanApprovalPending: (sessionId: string) => boolean
  seedBackgroundTaskKilled: (sessionId: string) => {
    turnId: string
    agentId: string
    taskId: string
  }
  seedRuntimeTask: (
    sessionId: string,
    opts?: {
      kind?: 'shell' | 'agent' | 'monitor' | 'schedule'
      status?: 'running' | 'scheduled' | 'completed'
      description?: string
    },
  ) => { taskId: string }
  simulateInvalidWorkflowError: (sessionId: string, reason?: string) => void
  getLastAssistantText: (sessionId: string) => string | null
  getPendingInterrupt: (sessionId: string) => { turnId: string; question: string } | null
  /** Focus / write-follow inspection for e2e. */
  getFocusedPath: () => string | null
  getFsActivePath: (sessionId: string) => string | null
  seedGoal: (
    sessionId: string,
    goal: { id?: string; description: string; status: 'active' | 'paused' | 'blocked' | 'completed'; turns?: number; maxTurns?: number },
  ) => void
  /** Last user message content sent via sendMessage (e2e annotation inject). */
  getLastOutboundUserContent: () => string | null
  /** Seed pending diff annotations (InputBar product inject path). */
  seedDiffAnnotation: (
    sessionId: string,
    ann: { path: string; body: string; note?: string },
  ) => string
  /** Mirror InputBar submit: format pending annotations + sendMessage. */
  sendWithPendingAnnotations: (sessionId: string, text: string) => void
  /**
   * Knowledge Live ↔ Source switch for e2e (R3 has no document-level mode chrome).
   * Sets hip-knowledge-live flag then store.setEditorMode so Workspace remounts.
   */
  knowledgeSetEditorMode: (mode: 'live' | 'source') => Promise<void>
  /** Current knowledge editorMode (live | source | preview). */
  knowledgeGetEditorMode: () => string | null
  /** Open a knowledge doc by id (awaits openDoc). */
  knowledgeOpenDoc: (docId: string) => Promise<void>
  /**
   * Force an automation schedule tick (DEV). Optional `now` is epoch ms so e2e
   * can advance due slots without waiting the real 30s host interval.
   * Installed by AutomationRunHost when AUTOMATION_PAGE is on.
   */
  automationTick?: (now?: number) => void
}

declare global {
  interface Window {
    __hipE2E?: HipE2EHooks
  }
}

export function installE2eHooks(svc: SessionService): void {
  if (typeof window === 'undefined') return
  // Production app builds must not expose inject surface.
  if (import.meta.env.PROD) return
  window.__hipE2E = {
    injectServerMessage: (msg) => svc.injectServerMessage(msg),
    simulateAgentWriteFinished: (sessionId, opts) => svc.simulateAgentWriteFinished(sessionId, opts),
    simulateToolStarted: (sessionId, opts) => svc.simulateToolStarted(sessionId, opts),
    simulateEditWithDiff: (sessionId, opts) => svc.simulateEditWithDiff(sessionId, opts),
    getActiveSessionId: () => useDomainStore.getState().activeSessionId,
    createChatSessionForE2e: () => svc.createChatSessionForE2e(),
    createCodeSessionForE2e: (cwd) => svc.createCodeSessionForE2e(cwd),
    simulateTurnRunning: (sessionId) => svc.simulateTurnRunning(sessionId),
    simulateTurnCancelled: (sessionId) => svc.simulateTurnCancelled(sessionId),
    simulateSessionError: (sessionId, code, message) => svc.simulateSessionError(sessionId, code, message),
    seedAgentCollaboration: (sessionId) => svc.seedAgentCollaboration(sessionId),
    getSessionDebugBundleJson: () => svc.getSessionDebugBundleJson(),
    simulatePermissionRequest: (sessionId) => svc.simulatePermissionRequest(sessionId),
    openCommandPaletteForE2e: () => svc.openCommandPaletteForE2e(),
    closeCommandPaletteForE2e: () => svc.closeCommandPaletteForE2e(),
    openSettingsPageForE2e: (page) => svc.openSettingsPageForE2e(page),
    openHistoryPageForE2e: () => svc.openHistoryPageForE2e(),
    openTrashPageForE2e: () => svc.openTrashPageForE2e(),
    closeOverlayForE2e: () => svc.closeOverlayForE2e(),
    simulatePluginInstallError: (error) => svc.simulatePluginInstallError(error),
    getMemoryConfig: () => svc.getMemoryConfig(),
    setMemoryConfig: (partial) => svc.setMemoryConfig(partial),
    seedMemoryItem: (item) => svc.upsertMemory(item),
    listMemories: (filter) => svc.listMemories(filter),
    deleteMemory: (id, hard) => svc.deleteMemory(id, hard),
    restoreMemory: (id) => svc.restoreMemory(id),
    emptyMemoryTrash: () => svc.emptyMemoryTrash(),
    triggerMemoryConsolidate: (projectKeyHash) => svc.consolidateMemories(projectKeyHash),
    getActiveSessionMemoryFlags: () => {
      const id = useDomainStore.getState().activeSessionId
      if (!id) return null
      const sess = useDomainStore.getState().sessions.find((s) => s.id === id)
      if (!sess) return null
      return {
        useMemories: sess.config?.useMemories,
        generateMemories: sess.config?.generateMemories,
        incognito: sess.config?.incognito,
      }
    },
    getActiveSessionForcePlan: () => {
      const id = useDomainStore.getState().activeSessionId
      if (!id) return null
      const sess = useDomainStore.getState().sessions.find((s) => s.id === id)
      if (!sess) return null
      return Boolean(sess.config?.forcePlan)
    },
    getWorkflowSession: (sessionId) => svc.getWorkflowSession(sessionId),
    seedSubagentPause: (sessionId) => svc.seedSubagentPause(sessionId),
    seedAgentInterrupt: (sessionId, question) => svc.seedAgentInterrupt(sessionId, question),
    seedPlanApproval: (sessionId) => svc.seedPlanApproval(sessionId),
    seedPlanProgress: (sessionId, opts) => svc.seedPlanProgress(sessionId, opts),
    setActiveModel: (providerID, modelID, baseURL = '') => {
      // Prefer catalog baseURL when empty.
      let resolved = baseURL
      if (!resolved) {
        const { catalog, config } = useProvidersStore.getState()
        try {
          resolved = resolveModelConfig(catalog, config, `${providerID}/${modelID}`).baseURL
        } catch {
          resolved =
            providerID === 'deepseek'
              ? 'https://api.deepseek.com/v1'
              : ''
        }
      }
      svc.setActiveModel(providerID, modelID, resolved)
      // Keep FE store in sync for picker UI.
      useProvidersStore.setState((s) => ({
        config: {
          ...s.config,
          activeModel: { providerID, modelID },
        },
      }))
    },
    reloadSession: (sessionId) => svc.reloadSession(sessionId),
    getPlanApprovalPending: (sessionId) => {
      const sess = useDomainStore.getState().sessions.find((s) => s.id === sessionId)
      return Boolean(sess?.planApprovalPending)
    },
    seedBackgroundTaskKilled: (sessionId) => svc.seedBackgroundTaskKilled(sessionId),
    seedRuntimeTask: (sessionId, opts) => svc.seedRuntimeTask(sessionId, opts),
    simulateInvalidWorkflowError: (sessionId, reason) => svc.simulateInvalidWorkflowError(sessionId, reason),
    getLastAssistantText: (sessionId) => svc.getLastAssistantText(sessionId),
    getPendingInterrupt: (sessionId) => svc.getPendingInterrupt(sessionId),
    getFocusedPath: () => useFocusStore.getState().focusedPath,
    getFsActivePath: (sessionId) => useFsStore.getState().bySession[sessionId]?.activePath ?? null,
    seedGoal: (sessionId, goal) => {
      if (goal.status === 'completed') {
        useGoalStore.getState().setGoal(sessionId, null)
        return
      }
      useGoalStore.getState().setGoal(sessionId, {
        id: goal.id ?? `goal-${Date.now()}`,
        description: goal.description,
        status: goal.status,
        turns: goal.turns,
        maxTurns: goal.maxTurns,
      })
    },
    getLastOutboundUserContent: () => svc.getLastOutboundUserContent(),
    seedDiffAnnotation: (sessionId, ann) =>
      useDiffAnnotationStore.getState().add(sessionId, ann),
    sendWithPendingAnnotations: (sessionId, text) => {
      // Same composition order as InputBar.submit (product path).
      const ann = useDiffAnnotationStore.getState().list(sessionId)
      const annBlock = formatDiffAnnotationsForComposer(ann)
      if (ann.length > 0) useDiffAnnotationStore.getState().clear(sessionId)
      let content = text
      if (annBlock) content = `${annBlock}${content}`
      useDomainStore.getState().selectSession(sessionId)
      svc.sendMessage(content, [])
    },
    knowledgeSetEditorMode: async (mode) => {
      try {
        localStorage.setItem(KNOWLEDGE_LIVE_FLAG_KEY, mode === 'live' ? 'true' : 'false')
      } catch {
        // private mode / quota
      }
      const st = useKnowledgeStore.getState()
      // Already Live but surface may still be Source (parse-block). Bounce through
      // source so Workspace bumps the Live attempt token and remounts Milkdown.
      if (mode === 'live' && st.editorMode === 'live') {
        await st.setEditorMode('source')
      }
      await useKnowledgeStore.getState().setEditorMode(mode)
    },
    knowledgeGetEditorMode: () => useKnowledgeStore.getState().editorMode ?? null,
    knowledgeOpenDoc: async (docId) => {
      await useKnowledgeStore.getState().openDoc(docId)
    },
  }
}


