import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { nanoid } from 'nanoid'
import { toast } from 'sonner'
import i18n from '@/i18n'
import { useDomainStore } from './sessionStore'
import { useFsStore } from '@/store/fsStore'
import { useUiStore } from '@/store/uiStore'
import { useDiffStore } from '@/store/diffStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { createDebouncedFn, shouldRefreshDiffOnToolFinish } from '@/lib/diffRefreshOnWrite'
import { extractAutoOpenArtifacts } from '@/lib/renderedArtifacts'
import { extractSearchSources } from '@/lib/searchSources'
import { surfaceOf } from '@/lib/sessions'
import { consumeUserDiffRequest } from '@/domain/commands/diffFeedback'
import { useParallelStore } from '@/store/parallelStore'
import { useWorktreeStore } from '@/store/worktreeStore'
import {
  commandFromRunScriptInput,
  pathFromToolInput,
  runScriptReferencesPath,
  shouldAutoFollowWrite,
  writeFollowPanelPolicy,
} from '@/lib/writeFollow'
import { useFocusStore } from '@/store/focusStore'
import { useGoalStore } from '@/store/goalStore'
import { resolveWorktreeListCatalogHost } from '@/lib/worktreeHostContext'
import { collectWorktreeCascadeDeleteIds } from '@/lib/worktreeNesting'
import { auditSessionDelete, debugSessionDelete } from '@/lib/sessionDelete'
import { useTaskRuntimeStore } from '@/store/taskRuntimeStore'

/** Must match sidecar KEEP_RECENT_TURNS — used only in no-op copy. */
const COMPACT_KEEP_RECENT_TURNS = 3

/** Build user-facing compact result body (transcript + toast). */
export function formatCompactResultMessage(
  msg: Extract<ServerMessage, { type: 'compact:result' }>,
): string {
  if (!msg.ok) {
    if (msg.reason === 'session_busy') {
      return i18n.t('chat.compact.busy')
    }
    return i18n.t('chat.compact.failed', { error: msg.error ?? msg.reason ?? 'unknown' })
  }
  if (!msg.applied) {
    return i18n.t('chat.compact.noop', { n: COMPACT_KEEP_RECENT_TURNS })
  }
  const lines: string[] = [
    i18n.t('chat.compact.applied', {
      before: msg.messagesBefore,
      after: msg.messagesAfter,
      tokensBefore: msg.tokensBefore,
      tokensAfter: msg.tokensAfter,
    }),
  ]
  if (msg.summary?.trim()) {
    lines.push('', msg.summary.trim())
  }
  return lines.join('\n')
}

/** Dependencies the side-effect router needs from SessionService (avoid circular imports). */
export interface ServerMessageEffectDeps {
  send(msg: ClientMessage): void
  requestDiff(sessionId: string): void
  requestCheckpoints(sessionId: string): void
  requestCommitLog(sessionId: string): void
  resyncActiveIfRunning(): void
}

/** Load path into FS preview + focus (shared by immediate / deferred write-follow). */
function applyWriteFollowPreview(
  sessionId: string,
  path: string,
  callId: string | null,
  deps: ServerMessageEffectDeps,
): void {
  useFsStore.getState().setActive(sessionId, path)
  useFsStore.getState().setPreview(sessionId, { status: 'loading', path })
  deps.send({ type: 'fs:read', sessionId, path })
  const focus = useFocusStore.getState()
  focus.setFocusedPath(path)
  if (callId) focus.setFocusedCallId(callId)
}

/**
 * Right-panel policy for a write-follow hit (mid-turn / deferred script flush).
 * Never force-opens a closed panel on either surface — Chat auto-open for
 * deliverables is solely on message:complete via extractAutoOpenArtifacts.
 * Code: if already open, keep Changes/Terminal; else switch to Files.
 * Chat: if already open, select Files + path for preview.
 */
function openWriteFollowPanel(sessionId: string, path: string, isCode: boolean): void {
  const domain = useDomainStore.getState()
  const ui = useUiStore.getState()
  const sess = domain.sessions.find((s) => s.id === sessionId)
  if (isCode) {
    if (!sess?.codePanelOpen) return
    const tab = ui.activeTab
    if (tab !== 'changes' && tab !== 'terminal') {
      ui.setTab('files')
    }
  } else {
    if (!sess?.chatPanelOpen) return
    ui.setChatActiveTab('files')
    ui.setSelectedArtifactPath(path)
  }
}

/** Per-session debounced full diff refresh after write tools (Sprint B). */
const debouncedRequestDiff = createDebouncedFn((sessionId: string) => {
  // Lazy import path: deps is closed over when the callback fires — we store latest deps.
  const d = lastDiffDeps
  if (!d) return
  const base = useDiffStore.getState().bySession[sessionId]?.base ?? 'session-start'
  d.send({ type: 'fs:diffSummary', sessionId, base })
  // Always refresh summary; also full diff when Changes tab is open or code surface is active.
  const tab = useUiStore.getState().activeTab
  const view = useUiStore.getState().activeView
  if (tab === 'changes' || view === 'code') {
    d.requestDiff(sessionId)
  }
}, 300)

let lastDiffDeps: ServerMessageEffectDeps | null = null

/**
 * Non-domain-store side effects for inbound ServerMessage traffic.
 * Domain projection stays in useDomainStore.apply; this module owns fs/diff refresh
 * and follow-up client requests so SessionService.receive stays a thin pipeline.
 */
export function applyServerMessageEffects(msg: ServerMessage, deps: ServerMessageEffectDeps): void {
  lastDiffDeps = deps
  useTaskRuntimeStore.getState().applyMessage(msg)
  switch (msg.type) {
    case 'ready':
      useDiffStore.getState().resetTransient()
      deps.send({ type: 'session:list' })
      // Early trash badge hydrate — do not wait for first Recycle Bin open.
      deps.send({ type: 'session:trash:list' })
      deps.resyncActiveIfRunning()
      return

    case 'agent:started': {
      // Roundtable council: open Chat Agents panel so multi-agent speech is visible live.
      // Respect user panel-dismiss for this turn (same as write-follow auto-open).
      if (
        typeof msg.agentId === 'string' &&
        msg.agentId.startsWith('roundtable:') &&
        msg.role === 'subagent'
      ) {
        const domain = useDomainStore.getState()
        const focus = useFocusStore.getState()
        const sess = domain.sessions.find((s) => s.id === msg.sessionId)
        if (
          sess &&
          surfaceOf(sess.config) === 'chat' &&
          domain.activeSessionId === msg.sessionId &&
          !focus.panelDismissedThisTurn
        ) {
          const ui = useUiStore.getState()
          ui.setChatActiveTab('agents')
          domain.setSessionChatPanelOpen(msg.sessionId, true)
          focus.setFocusedAgentId(msg.agentId)
        }
      }
      return
    }

    case 'error':
      // Dedicated soft-reject from session:setAgent (running or already switching).
      if (msg.code === 'AGENT_BUSY') {
        toast.error(i18n.t('composer.agentSwitch.busy'))
      }
      return

    case 'fs:ls:result':
      useFsStore.getState().setEntries(msg.sessionId, msg.path, msg.entries)
      return

    case 'fs:read:result':
      useFsStore.getState().applyPreviewResult(msg.sessionId, {
        path: msg.path,
        content: msg.content,
        encoding: msg.encoding,
        mimeType: msg.mimeType,
        truncated: msg.truncated,
        error: msg.error,
      })
      return

    case 'fs:lsCwd:result':
      useFsStore.getState().setEntries(msg.cwd, msg.path, msg.entries)
      return

    case 'fs:readCwd:result':
      useFsStore.getState().applyPreviewResult(msg.cwd, {
        path: msg.path,
        content: msg.content,
        encoding: msg.encoding,
        mimeType: msg.mimeType,
        truncated: msg.truncated,
        error: msg.error,
      })
      return

    case 'fs:diff:result': {
      useDiffStore.getState().setResult(msg.sessionId, {
        state: msg.state,
        files: msg.files,
        summary: msg.summary,
        base: msg.base,
        hasSessionStart: msg.hasSessionStart,
        error: msg.error,
      })
      // User-triggered /diff or palette "Show changes": toast when workspace is clean / failed.
      if (consumeUserDiffRequest(msg.sessionId)) {
        if (msg.state === 'ok' && (!msg.files || msg.files.length === 0)) {
          toast.message(i18n.t('chat.diff.empty'))
        } else if (msg.state !== 'ok' && msg.error) {
          toast.error(i18n.t('chat.diff.failed', { error: msg.error }))
        }
      }
      return
    }

    case 'fs:diffSummary:result':
      if (msg.summary) useDiffStore.getState().setSummary(msg.sessionId, msg.summary, msg.base, msg.hasSessionStart)
      return

    case 'fs:diffFile:result':
      if (msg.file) useDiffStore.getState().setFileExpanded(msg.sessionId, msg.path, msg.file)
      return

    case 'fs:gitInit:result':
      useDiffStore.getState().setInitPending(msg.sessionId, false)
      if (msg.ok) {
        deps.requestDiff(msg.sessionId)
        deps.requestCheckpoints(msg.sessionId)
        toast.success(i18n.t('chat.init.success'))      } else {
        useDiffStore.getState().setResult(msg.sessionId, {
          state: 'not_a_repo',
          base: 'head',
          hasSessionStart: false,
          error: msg.error,
        })
        const err = msg.error ?? 'unknown'
        if (err === 'no_workspace') {
          toast.error(i18n.t('chat.init.noWorkspace'))
        } else {
          toast.error(i18n.t('chat.init.failed', { error: err }))
        }
      }
      return

    case 'git:checkpoint:list:result':
      useDiffStore.getState().setGitState(msg.sessionId, msg.isGitRepo, msg.currentBranch)
      return

    case 'git:commitLog:result':
      useDiffStore.getState().setCommitLogResult(msg.sessionId, {
        state: msg.state,
        commits: msg.commits,
        error: msg.error,
      })
      return

    case 'git:branch:list:result':
      useDiffStore.getState().setBranches(msg.sessionId, msg.branches, msg.currentBranch)
      return

    case 'git:branch:switch:result':
      if (msg.ok) {
        useDiffStore.getState().setBranches(
          msg.sessionId,
          useDiffStore.getState().bySession[msg.sessionId]?.branches ?? [],
          msg.currentBranch,
        )
        deps.send({ type: 'git:branch:list', sessionId: msg.sessionId })
        const base = useDiffStore.getState().bySession[msg.sessionId]?.base ?? 'session-start'
        deps.send({ type: 'fs:diffSummary', sessionId: msg.sessionId, base })
      } else {
        useDiffStore.getState().setSwitchError(msg.sessionId, msg.error ?? 'switch_failed')
      }
      return

    case 'session:created':
    case 'session:cwd': {
      const base = useDiffStore.getState().bySession[msg.sessionId]?.base ?? 'session-start'
      deps.send({ type: 'fs:diffSummary', sessionId: msg.sessionId, base })
      deps.send({ type: 'git:checkpoint:list', sessionId: msg.sessionId })
      return
    }

    case 'tool:finished': {
      // tool:finished has no name — resolve from in-flight toolCalls on the turn message.
      const domain = useDomainStore.getState()
      const sess = domain.sessions.find((s) => s.id === msg.sessionId)
      const turn = sess?.messages.find((m) => m.id === msg.turnId || m.toolCalls?.some((tc) => tc.callId === msg.callId))
      const tool = turn?.toolCalls?.find((tc) => tc.callId === msg.callId)
      const name = tool?.name ?? ''
      if (shouldRefreshDiffOnToolFinish(name, msg.status)) {
        debouncedRequestDiff(msg.sessionId)
      }

      // run_script that executes a deferred script write → cancel deferred panel open
      // (stdout in the transcript is the primary surface).
      if (tool && name === 'run_script' && msg.status === 'finished') {
        const focus = useFocusStore.getState()
        const deferred = focus.deferredWriteFollow
        if (deferred && deferred.sessionId === msg.sessionId) {
          const cmd = commandFromRunScriptInput(tool.input)
          if (runScriptReferencesPath(cmd, deferred.path)) {
            focus.clearDeferredWriteFollow()
          }
        }
      }

      // P1 C1: auto-follow write-like tools to preview before turn ends.
      // Neither surface force-opens a closed panel here (Chat deliverable open is
      // message:complete only). Script-like paths defer until turn end (cancelled
      // if run_script consumes them); ephemeral paths never follow.
      const focus = useFocusStore.getState()
      const path = tool ? pathFromToolInput(name, tool.input) : null
      if (
        tool &&
        shouldAutoFollowWrite({
          autoFollow: focus.autoFollowEdits,
          followPaused: focus.followPaused,
          panelDismissedThisTurn: focus.panelDismissedThisTurn,
          isActiveSession: domain.activeSessionId === msg.sessionId,
          toolName: name,
          status: msg.status,
          path,
        }) &&
        path
      ) {
        const policy = writeFollowPanelPolicy(path)
        if (policy === 'skip') {
          // shouldAutoFollowWrite already filters ephemeral; keep defensive.
          return
        }

        const isCode = sess ? surfaceOf(sess.config) === 'code' : false
        const panelAlreadyOpen = isCode
          ? sess?.codePanelOpen === true
          : sess?.chatPanelOpen === true

        if (policy === 'defer' && !panelAlreadyOpen) {
          // Stash for message:complete; do not steal chat width for write-then-run.
          focus.setDeferredWriteFollow({
            sessionId: msg.sessionId,
            path,
            callId: msg.callId,
          })
          return
        }

        // Immediate, or deferred while panel is already open → follow into the file.
        focus.clearDeferredWriteFollow()
        applyWriteFollowPreview(msg.sessionId, path, msg.callId, deps)
        if (sess) openWriteFollowPanel(msg.sessionId, path, isCode)
      }
      return
    }

    case 'message:complete': {
      const domain = useDomainStore.getState()
      const sess = domain.sessions.find((s) => s.id === msg.sessionId)
      const focus = useFocusStore.getState()

      // Flush deferred script write-follow when the turn ends without a consuming run_script.
      // Preview/focus only — openWriteFollowPanel never force-opens a closed panel.
      // Run before the generic activePath refresh so the deliverable path wins.
      const deferred = focus.deferredWriteFollow
      let followedPath: string | null = null
      if (
        deferred &&
        deferred.sessionId === msg.sessionId &&
        domain.activeSessionId === msg.sessionId &&
        sess &&
        !focus.panelDismissedThisTurn &&
        focus.autoFollowEdits &&
        !focus.followPaused
      ) {
        const isCode = surfaceOf(sess.config) === 'code'
        applyWriteFollowPreview(msg.sessionId, deferred.path, deferred.callId, deps)
        openWriteFollowPanel(msg.sessionId, deferred.path, isCode)
        followedPath = deferred.path
        focus.clearDeferredWriteFollow()
      } else if (deferred && deferred.sessionId === msg.sessionId) {
        focus.clearDeferredWriteFollow()
      }

      // Chat surface: force-open PreviewPanel for durable final deliverables
      // (image/md/html/pdf, excluding draft/wip/ephemeral process paths). When
      // this turn only did web research (no file product), open Sources instead.
      if (
        sess &&
        surfaceOf(sess.config) === 'chat' &&
        domain.activeSessionId === msg.sessionId &&
        !focus.panelDismissedThisTurn &&
        focus.autoFollowEdits
      ) {
        const arts = extractAutoOpenArtifacts(msg.message.toolCalls)
        if (arts.length > 0) {
          const last = arts[arts.length - 1]
          applyWriteFollowPreview(msg.sessionId, last.path, null, deps)
          followedPath = last.path
          const ui = useUiStore.getState()
          ui.setChatActiveTab('files')
          ui.setSelectedArtifactPath(last.path)
          domain.setSessionChatPanelOpen(msg.sessionId, true)
        } else if (extractSearchSources(msg.message.toolCalls).length > 0) {
          const ui = useUiStore.getState()
          ui.setChatActiveTab('sources')
          domain.setSessionChatPanelOpen(msg.sessionId, true)
        }
      }

      const fsState = useFsStore.getState().bySession[msg.sessionId]
      if (fsState) {
        for (const dir of Object.keys(fsState.entriesByDir)) {
          deps.send({ type: 'fs:ls', sessionId: msg.sessionId, path: dir })
        }
        // Skip redundant re-read when write-follow/auto-open already requested this path.
        if (fsState.activePath && fsState.activePath !== followedPath) {
          deps.send({ type: 'fs:read', sessionId: msg.sessionId, path: fsState.activePath })
        }
      }
      const base = useDiffStore.getState().bySession[msg.sessionId]?.base ?? 'session-start'
      deps.send({ type: 'fs:diffSummary', sessionId: msg.sessionId, base })
      deps.send({ type: 'git:checkpoint:list', sessionId: msg.sessionId })
      const tab = useUiStore.getState().activeTab
      const view = useUiStore.getState().activeView
      // Code surface: always refresh full diff after a turn so Changes stays honest after cancel/complete.
      if (tab === 'changes' || view === 'code') {
        deps.requestDiff(msg.sessionId)
        if (tab === 'changes') deps.requestCommitLog(msg.sessionId)
      }
      return
    }

    case 'plan:respond:result':
      // KD-16: toast on failure so optimistic dismiss + silent skip is never invisible.
      if (!msg.ok) {
        toast.error(i18n.t('chat.plan.respondFailedTitle'), {
          description: i18n.t('chat.plan.respondFailedBody', {
            reason: msg.reason ?? 'unknown',
          }),
        })
      }
      return

    case 'compact:result': {
      const content = formatCompactResultMessage(msg)
      if (msg.ok && msg.applied) {
        useDomainStore.getState().appendMessage(msg.sessionId, {
          id: nanoid(),
          role: 'assistant',
          content,
          timestamp: Date.now(),
        })
      } else if (msg.ok && !msg.applied) {
        // No-op: status strip in transcript + toast so short sessions aren't silent.
        useDomainStore.getState().appendMessage(msg.sessionId, {
          id: nanoid(),
          role: 'assistant',
          content,
          timestamp: Date.now(),
        })
        toast.message(i18n.t('chat.compact.noopTitle'), { description: content })
      } else {
        toast.error(i18n.t('chat.compact.failedTitle'), { description: content })
        useDomainStore.getState().appendMessage(msg.sessionId, {
          id: nanoid(),
          role: 'assistant',
          content,
          timestamp: Date.now(),
        })
      }
      return
    }

    case 'workflow:started': {
      useWorkflowStore.getState().setActiveWorkflow(msg.sessionId, msg.def, msg.runId)
      // Focus Agents panel (DAG tab removed — collaboration lives under Agents).
      const domain = useDomainStore.getState()
      if (domain.activeSessionId === msg.sessionId) {
        const session = domain.sessions.find((s) => s.id === msg.sessionId)
        if (session?.config.surface !== 'chat') {
          domain.setSessionCodePanelOpen(msg.sessionId, true)
          useUiStore.getState().setTab('agents')
        }
      }
      return
    }
    case 'workflow:event':
      useWorkflowStore.getState().applyEvent(msg.sessionId, msg.runId, msg.event)
      return
    case 'workflow:snapshot':
      useWorkflowStore.getState().setSnapshot(msg.sessionId, msg.def, msg.state)
      return
    case 'workflow:cleared':
      useWorkflowStore.getState().clearSession(msg.sessionId)
      return
    case 'session:loaded':
      // Sprint C: no longer request workflow:getActive — product path does not surface workflows.
      return
    case 'session:deleted':
      useWorkflowStore.getState().clearSession(msg.sessionId)
      return
    case 'session:trashed':
      useWorkflowStore.getState().clearSession(msg.sessionId)
      return
    case 'session:restored':
      void import('@/store/trashBadgeStore').then(({ useTrashBadgeStore }) => {
        useTrashBadgeStore.getState().adjustSessions(-1)
      })
      toast.success(i18n.t('trash.restoredToast', { defaultValue: 'Restored from recycle bin' }))
      return
    case 'session:trash:list:result':
      void import('@/store/trashBadgeStore').then(({ useTrashBadgeStore }) => {
        useTrashBadgeStore.getState().setSessionCount(msg.sessions.length)
      })
      void import('@/store/trashListStore').then(({ useTrashListStore }) => {
        useTrashListStore.getState().setSessions(msg.sessions)
      })
      return
    case 'session:trash:purge:result':
      if (msg.purgedIds.length > 0) {
        void import('@/store/trashBadgeStore').then(({ useTrashBadgeStore }) => {
          useTrashBadgeStore.getState().adjustSessions(-msg.purgedIds.length)
        })
        void import('@/store/trashListStore').then(({ useTrashListStore }) => {
          const st = useTrashListStore.getState()
          st.setSessions(st.sessions.filter((s) => !msg.purgedIds.includes(s.id)))
        })
      }
      return

    case 'parallel:started': {
      useParallelStore.getState().addRun({
        id: msg.runId,
        baseCwd: msg.baseCwd,
        prompt: msg.goal,
        hostSessionId: msg.sessionId,
        source: 'agent',
        createdAt: Date.now(),
        slots: msg.slots.map((s) => ({
          index: s.index,
          sessionId: '',
          taskId: s.taskId,
          worktreeId: s.worktreeId,
          worktreePath: s.path,
          branch: s.branch,
          status: 'ready' as const,
        })),
      })
      toast.success(
        i18n.t('chat.parallel.started', { count: msg.slots.length }),
      )
      return
    }

    case 'goal:updated': {
      if (!msg.goal) {
        useGoalStore.getState().setGoal(msg.sessionId, null)
        return
      }
      useGoalStore.getState().setGoal(msg.sessionId, {
        id: msg.goal.id,
        description: msg.goal.description,
        status: msg.goal.status,
        turns: msg.goal.turns,
        maxTurns: msg.goal.maxTurns,
      })
      return
    }

    case 'worktree:changed': {
      useWorktreeStore.getState().applyChanged(msg.worktree, msg.kind)
      // Dual-store consistency: parallel sidebar slots are a live projection of worktrees.
      // Domain event is the fast path; list snapshot (below) is the safety net.
      if (msg.kind === 'removed') {
        const removedPath = msg.worktree.path
        const runs = useParallelStore.getState().runs
        const sessions = useDomainStore.getState().sessions
        const cascade = collectWorktreeCascadeDeleteIds({
          removedPath,
          removedWorktreeId: msg.worktree.id,
          runs,
          sessions: sessions.map((s) => ({
            id: s.id,
            title: s.title,
            config: { cwd: s.config.cwd },
          })),
        })
        debugSessionDelete('worktree:changed removed — cascade plan', {
          removedPath,
          removedWorktreeId: msg.worktree.id,
          hostSessionId: msg.sessionId,
          toDelete: cascade.toDelete,
          skipped: cascade.skipped,
          candidatesFromSlots: cascade.candidatesFromSlots,
          candidatesFromCwd: cascade.candidatesFromCwd,
          parallelRunCount: runs.length,
          sessionCount: sessions.length,
        })
        for (const s of cascade.skipped) {
          auditSessionDelete('skip', {
            sessionId: s.id,
            reason: 'worktree-cascade',
            why: s.why,
            removedPath,
            removedWorktreeId: msg.worktree.id,
          })
        }
        useParallelStore.getState().pruneSlotsMatching({
          paths: removedPath ? [removedPath] : [],
          worktreeIds: msg.worktree.id ? [msg.worktree.id] : [],
        })
        if (cascade.toDelete.length > 0) {
          auditSessionDelete('batch-start', {
            reason: 'worktree-cascade',
            count: cascade.toDelete.length,
            ids: cascade.toDelete,
            removedPath,
          })
          // Lazy import avoids circular graph: sessionService → effects → sessionService.
          void import('./sessionService').then(({ sessionService }) => {
            for (const id of cascade.toDelete) {
              sessionService.deleteSession(id, {
                reason: 'worktree-cascade',
                meta: { removedPath, removedWorktreeId: msg.worktree.id },
              })
            }
            auditSessionDelete('batch-done', {
              reason: 'worktree-cascade',
              count: cascade.toDelete.length,
            })
          })
        }
      }
      // Same-process only toast (not CLI spawn).
      if (msg.kind === 'created' && msg.reveal) {
        toast.success(
          i18n.t('chat.worktree.created', {
            defaultValue: 'Worktree ready: {{label}}',
            label: msg.worktree.label || msg.worktree.branch || msg.worktree.path,
          }),
        )
      }
      return
    }

    case 'git:worktree:list:result': {
      // Authoritative snapshot: upsert + prune catalog, then reconcile parallel slots for this host.
      // Resolve nested/slot requester → project host so catalog rows stay under the host tree
      // (selectSession on a worktree slot also requests list and must not steal host binding).
      const sessions = useDomainStore.getState().sessions
      const requester = sessions.find((s) => s.id === msg.sessionId)
      const catalogHostId = resolveWorktreeListCatalogHost({
        sessionId: msg.sessionId,
        worktrees: msg.worktrees,
        activeSession: requester
          ? {
              id: requester.id,
              config: { cwd: requester.config.cwd, surface: requester.config.surface },
            }
          : { id: msg.sessionId, config: {} },
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          config: { cwd: s.config.cwd },
        })),
        runs: useParallelStore.getState().runs,
        catalog: Object.values(useWorktreeStore.getState().byId),
      })
      useWorktreeStore.getState().upsertFromList(msg.worktrees, catalogHostId)
      useParallelStore.getState().reconcileToLivePaths(
        msg.worktrees.map((w) => w.path),
        catalogHostId,
      )
      return
    }

    default:
      return
  }
}
