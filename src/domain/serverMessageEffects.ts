import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { nanoid } from 'nanoid'
import { useDomainStore } from './sessionStore'
import { useFsStore } from '@/store/fsStore'
import { useUiStore } from '@/store/uiStore'
import { useDiffStore } from '@/store/diffStore'

/** Dependencies the side-effect router needs from SessionService (avoid circular imports). */
export interface ServerMessageEffectDeps {
  send(msg: ClientMessage): void
  requestDiff(sessionId: string): void
  requestCheckpoints(sessionId: string): void
  requestCommitLog(sessionId: string): void
  resyncActiveIfRunning(): void
}

/**
 * Non-domain-store side effects for inbound ServerMessage traffic.
 * Domain projection stays in useDomainStore.apply; this module owns fs/diff refresh
 * and follow-up client requests so SessionService.receive stays a thin pipeline.
 */
export function applyServerMessageEffects(msg: ServerMessage, deps: ServerMessageEffectDeps): void {
  switch (msg.type) {
    case 'ready':
      useDiffStore.getState().resetTransient()
      deps.send({ type: 'session:list' })
      deps.resyncActiveIfRunning()
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

    case 'fs:diff:result':
      useDiffStore.getState().setResult(msg.sessionId, {
        state: msg.state,
        files: msg.files,
        summary: msg.summary,
        base: msg.base,
        hasSessionStart: msg.hasSessionStart,
        error: msg.error,
      })
      return

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
      } else {
        useDiffStore.getState().setResult(msg.sessionId, {
          state: 'not_a_repo',
          base: 'head',
          hasSessionStart: false,
          error: msg.error,
        })
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
      if (msg.ok) {
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
      if (tab === 'changes') {
        deps.requestDiff(msg.sessionId)
        deps.requestCommitLog(msg.sessionId)
      }
      return
    }

    case 'compact:result':
      if (msg.ok) {
        useDomainStore.getState().appendMessage(msg.sessionId, {
          id: nanoid(),
          role: 'assistant',
          content: `Conversation compacted: ${msg.messagesBefore} messages → ${msg.messagesAfter} messages`,
          timestamp: Date.now(),
        })
      }
      return

    default:
      return
  }
}
