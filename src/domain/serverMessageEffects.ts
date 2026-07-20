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
import { extractRenderedArtifacts } from '@/lib/renderedArtifacts'
import { surfaceOf } from '@/lib/sessions'
import { consumeUserDiffRequest } from '@/domain/commands/diffFeedback'
import { useParallelStore } from '@/store/parallelStore'
import { useWorktreeStore } from '@/store/worktreeStore'
import { pathFromToolInput, shouldAutoFollowWrite } from '@/lib/writeFollow'
import { useFocusStore } from '@/store/focusStore'
import { useGoalStore } from '@/store/goalStore'
import { collectWorktreeCascadeDeleteIds } from '@/lib/worktreeNesting'
import { auditSessionDelete, debugSessionDelete } from '@/lib/sessionDelete'

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
  switch (msg.type) {
    case 'ready':
      useDiffStore.getState().resetTransient()
      deps.send({ type: 'session:list' })
      deps.resyncActiveIfRunning()
      return

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
      useFsStore.getState().setPreview(msg.sessionId, {
        status: 'ready',
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
      useFsStore.getState().setPreview(msg.cwd, {
        status: 'ready',
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
        toast.success(i18n.t('chat.init.success'))
      } else {
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
      useDiffStore.getState().setCheckpoints(msg.sessionId, msg.checkpoints, msg.isGitRepo, msg.currentBranch)
      return

    case 'checkpoint:created':
      useDiffStore.getState().addCheckpoint(msg.sessionId, msg.checkpoint)
      return

    case 'git:checkpoint:diff:result':
      useDiffStore.getState().setCheckpointDiffResult(
        msg.sessionId,
        `${msg.checkpointId}|${msg.mode}`,
        { state: msg.state, files: msg.files, summary: msg.summary, error: msg.error },
      )
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
        useDiffStore.getState().clearCheckpointDiffCache(msg.sessionId)
        deps.send({ type: 'git:branch:list', sessionId: msg.sessionId })
        deps.send({ type: 'git:checkpoint:list', sessionId: msg.sessionId })
        const base = useDiffStore.getState().bySession[msg.sessionId]?.base ?? 'session-start'
        deps.send({ type: 'fs:diffSummary', sessionId: msg.sessionId, base })
      } else {
        useDiffStore.getState().setSwitchError(msg.sessionId, msg.error ?? 'switch_failed')
      }
      return

    case 'git:revert:result':
      useDiffStore.getState().setLastRevertResult(msg.sessionId, {
        checkpointId: msg.checkpointId,
        ok: msg.ok,
        safetyCheckpointId: msg.safetyCheckpointId,
      })
      if (msg.ok) {
        useDiffStore.getState().setRevertError(msg.sessionId, null)
        useDiffStore.getState().clearCheckpointDiffCache(msg.sessionId)
        deps.send({ type: 'git:checkpoint:list', sessionId: msg.sessionId })
        const base = useDiffStore.getState().bySession[msg.sessionId]?.base ?? 'session-start'
        deps.send({ type: 'fs:diffSummary', sessionId: msg.sessionId, base })
      } else {
        useDiffStore.getState().setRevertError(msg.sessionId, msg.error ?? 'revert_failed')
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
      // P1 C1: auto-follow write-like tools to preview before turn ends.
      const focus = useFocusStore.getState()
      if (
        tool &&
        shouldAutoFollowWrite({
          autoFollow: focus.autoFollowEdits,
          followPaused: focus.followPaused,
          isActiveSession: domain.activeSessionId === msg.sessionId,
          toolName: name,
          status: msg.status,
        })
      ) {
        const path = pathFromToolInput(name, tool.input)
        if (path) {
          useFsStore.getState().setActive(msg.sessionId, path)
          useFsStore.getState().setPreview(msg.sessionId, { status: 'loading', path })
          deps.send({ type: 'fs:read', sessionId: msg.sessionId, path })
          focus.setFocusedPath(path)
          focus.setFocusedCallId(msg.callId)
          const ui = useUiStore.getState()
          if (sess && surfaceOf(sess.config) === 'code') {
            // Keep Changes/Terminal if already there — only auto-open Files when not reviewing diffs.
            const tab = ui.activeTab
            if (tab !== 'changes' && tab !== 'terminal') {
              ui.setTab('files')
            }
            domain.setSessionCodePanelOpen(msg.sessionId, true)
          } else if (sess) {
            ui.setChatActiveTab('files')
            ui.setSelectedArtifactPath(path)
            domain.setSessionChatPanelOpen(msg.sessionId, true)
          }
        }
      }
      return
    }

    case 'message:complete': {
      const fsState = useFsStore.getState().bySession[msg.sessionId]
      if (fsState) {
        for (const dir of Object.keys(fsState.entriesByDir)) {
          deps.send({ type: 'fs:ls', sessionId: msg.sessionId, path: dir })
        }
        if (fsState.activePath) {
          deps.send({ type: 'fs:read', sessionId: msg.sessionId, path: fsState.activePath })
        }
      }
      useDiffStore.getState().clearCheckpointDiffCache(msg.sessionId)
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
      // Chat surface: auto-open PreviewPanel on the latest renderable write so HTML/images/docs
      // actually appear without requiring a manual card click (Claude Artifacts-style).
      const domain = useDomainStore.getState()
      const sess = domain.sessions.find((s) => s.id === msg.sessionId)
      if (sess && surfaceOf(sess.config) === 'chat' && domain.activeSessionId === msg.sessionId) {
        const arts = extractRenderedArtifacts(msg.message.toolCalls)
        if (arts.length > 0) {
          const last = arts[arts.length - 1]
          useFsStore.getState().setActive(msg.sessionId, last.path)
          useFsStore.getState().setPreview(msg.sessionId, { status: 'loading', path: last.path })
          deps.send({ type: 'fs:read', sessionId: msg.sessionId, path: last.path })
          const ui = useUiStore.getState()
          ui.setChatActiveTab('files')
          ui.setSelectedArtifactPath(last.path)
          domain.setSessionChatPanelOpen(msg.sessionId, true)
        }
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
      useWorktreeStore.getState().applyChanged(msg.worktree, msg.kind, msg.reveal)
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
      useWorktreeStore.getState().upsertFromList(msg.worktrees, msg.sessionId)
      useParallelStore.getState().reconcileToLivePaths(
        msg.worktrees.map((w) => w.path),
        msg.sessionId,
      )
      return
    }

    default:
      return
  }
}
