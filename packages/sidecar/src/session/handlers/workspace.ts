import type { ClientMessage } from '@hip/protocol'
import * as workspaceGit from '../workspace-git.js'
import type { SendFn, SessionManagerContext } from './types.js'

export const WORKSPACE_MESSAGE_TYPES = new Set([
  'fs:ls',
  'fs:read',
  'fs:lsCwd',
  'fs:readCwd',
  'fs:diff',
  'fs:diffSummary',
  'fs:diffFile',
  'fs:gitInit',
  'git:checkpoint:list',
  'git:commitLog',
  'git:commitDiff',
  'git:discard',
  'git:branch:list',
  'git:branch:switch',
])

/** True when msg.type is handled by handleWorkspaceMessage (sync check — do not await first). */
export function isWorkspaceMessage(msg: ClientMessage): boolean {
  return WORKSPACE_MESSAGE_TYPES.has(msg.type)
}

/** Handle a workspace (fs/git) client message. Caller must gate with isWorkspaceMessage. */
export async function handleWorkspaceMessage(
  ctx: SessionManagerContext,
  msg: ClientMessage,
  send: SendFn,
): Promise<void> {
  switch (msg.type) {
    case 'fs:ls': {
      const r = await ctx.ensureSession(msg.sessionId, send).lsDir(msg.path)
      send({ type: 'fs:ls:result', sessionId: msg.sessionId, path: msg.path, entries: r.entries ?? [], error: r.error })
      return
    }
    case 'fs:read': {
      const r = await ctx.ensureSession(msg.sessionId, send).readForPreview(msg.path)
      send(
        'error' in r
          ? { type: 'fs:read:result', sessionId: msg.sessionId, path: msg.path, error: r.error }
          : { type: 'fs:read:result', sessionId: msg.sessionId, path: msg.path, content: r.content, encoding: r.encoding, mimeType: r.mimeType, truncated: r.truncated },
      )
      return
    }
    case 'fs:lsCwd': {
      const r = await ctx.lsCwd(msg.cwd, msg.path)
      send({ type: 'fs:lsCwd:result', cwd: msg.cwd, path: msg.path, entries: r.entries ?? [], error: r.error })
      return
    }
    case 'fs:readCwd': {
      const r = await ctx.readCwd(msg.cwd, msg.path)
      send(
        'error' in r
          ? { type: 'fs:readCwd:result', cwd: msg.cwd, path: msg.path, error: r.error }
          : { type: 'fs:readCwd:result', cwd: msg.cwd, path: msg.path, content: r.content, encoding: r.encoding, mimeType: r.mimeType, truncated: r.truncated },
      )
      return
    }
    case 'fs:diff': {
      const r = await ctx.ensureSession(msg.sessionId, send).workspaceDiff(msg.base ?? 'session-start', msg.ignoreWhitespace ?? false)
      send({ type: 'fs:diff:result', sessionId: msg.sessionId, ...r })
      return
    }
    case 'fs:diffSummary': {
      const r = await ctx.ensureSession(msg.sessionId, send).workspaceDiffSummary(msg.base ?? 'session-start')
      send({ type: 'fs:diffSummary:result', sessionId: msg.sessionId, ...r })
      return
    }
    case 'fs:diffFile': {
      const r = await ctx.ensureSession(msg.sessionId, send).workspaceDiffFile(msg.path, msg.base ?? 'session-start', msg.context)
      send({ type: 'fs:diffFile:result', sessionId: msg.sessionId, path: msg.path, base: msg.base ?? 'session-start', state: r.state, file: r.file, error: r.error })
      return
    }
    case 'fs:gitInit': {
      const r = await ctx.ensureSession(msg.sessionId, send).workspaceGitInit()
      send({ type: 'fs:gitInit:result', sessionId: msg.sessionId, ok: r.ok, ...(r.error ? { error: r.error } : {}) })
      return
    }
    case 'git:checkpoint:list': {
      const r = await ctx.ensureSession(msg.sessionId, send).listCheckpoints()
      send({ type: 'git:checkpoint:list:result', sessionId: msg.sessionId, checkpoints: r.checkpoints, isGitRepo: r.isGitRepo, currentBranch: r.currentBranch })
      return
    }
    case 'git:commitLog': {
      const r = await ctx.ensureSession(msg.sessionId, send).commitLog()
      send({ type: 'git:commitLog:result', sessionId: msg.sessionId, commits: r.commits ?? [], state: r.state, error: r.error })
      return
    }
    case 'git:commitDiff': {
      const r = await ctx.ensureSession(msg.sessionId, send).commitDiff(msg.sha)
      send({ type: 'git:commitDiff:result', sessionId: msg.sessionId, sha: msg.sha, state: r.state, files: r.files, error: r.error })
      return
    }
    case 'git:discard': {
      const r = await ctx.ensureSession(msg.sessionId, send).discardFile(msg.path, msg.status, msg.oldPath)
      send({ type: 'git:discard:result', sessionId: msg.sessionId, path: msg.path, ok: r.ok, ...(r.error ? { error: r.error } : {}) })
      return
    }
    case 'git:branch:list': {
      const r = await ctx.ensureSession(msg.sessionId, send).listBranches()
      send({ type: 'git:branch:list:result', sessionId: msg.sessionId, branches: r.branches, currentBranch: r.currentBranch })
      return
    }
    case 'git:branch:switch': {
      const r = await ctx.ensureSession(msg.sessionId, send).switchBranch(msg.branch)
      send({ type: 'git:branch:switch:result', sessionId: msg.sessionId, branch: msg.branch, ok: r.ok, currentBranch: r.currentBranch, ...(r.error ? { error: r.error } : {}) })
      return
    }
    default:
      return
  }
}
