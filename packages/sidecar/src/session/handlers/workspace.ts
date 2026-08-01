import type { ClientMessage } from '@hip/protocol'
import * as workspaceGit from '../workspace-git.js'
import { createManagedProductWorktree } from '../worktree-product-create.js'
import { createWorktreeService } from '../worktree-service.js'
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
  'git:branch:list',
  'git:branch:switch',
  'git:worktree:create',
  'git:worktree:list',
  'git:worktree:remove',
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
      const r = await ctx.ensureSession(msg.sessionId, send).workspaceDiff(msg.base ?? 'session-start')
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
    case 'git:worktree:create': {
      const s = ctx.ensureSession(msg.sessionId, send)
      const cwd = s.config.cwd
      if (!cwd) { send({ type: 'git:worktree:create:result', sessionId: msg.sessionId, ok: false, error: 'no cwd' }); return }
      // createBranch stays in handler (branch must exist before service.create worktree add).
      if (msg.createBranch) {
        const br = await workspaceGit.gitCreateBranch(cwd, msg.branch, 'git', msg.baseRef)
        if (!br.ok) {
          const err = (br.error ?? '').toLowerCase()
          // Branch may already exist from a prior slot attempt — continue to worktree add.
          if (!err.includes('already exists') && !err.includes('already exist')) {
            send({ type: 'git:worktree:create:result', sessionId: msg.sessionId, ok: false, error: br.error ?? 'create branch failed' })
            return
          }
        }
      }
      const svc = createWorktreeService({
        notify: (ev) => send({ type: 'worktree:changed', ...ev }),
      })
      // D23: reveal pass-through. D7/D26: source/label pass-through (default protocol).
      const r = await createManagedProductWorktree(svc, {
        cwd,
        branch: msg.branch,
        pathKey: msg.pathKey,
        source: msg.source ?? 'protocol',
        hostSessionId: msg.sessionId,
        ...(msg.label !== undefined ? { label: msg.label } : {}),
        ...(msg.reveal !== undefined ? { reveal: msg.reveal } : {}),
      })
      send({
        type: 'git:worktree:create:result',
        sessionId: msg.sessionId,
        ok: r.ok,
        ...(r.path ? { path: r.path } : {}),
        ...(r.worktree?.id ? { id: r.worktree.id } : {}),
        ...(r.error ? { error: r.error } : {}),
      })
      return
    }
    case 'git:worktree:list': {
      const s = ctx.ensureSession(msg.sessionId, send)
      const cwd = s.config.cwd
      if (!cwd) { send({ type: 'git:worktree:list:result', sessionId: msg.sessionId, worktrees: [] }); return }
      const svc = createWorktreeService()
      const r = await svc.list({ cwd, managedOnly: true })
      send({ type: 'git:worktree:list:result', sessionId: msg.sessionId, worktrees: r.worktrees })
      return
    }
    case 'git:worktree:remove': {
      const s = ctx.ensureSession(msg.sessionId, send)
      const cwd = s.config.cwd
      if (!cwd) { send({ type: 'git:worktree:remove:result', sessionId: msg.sessionId, ok: false, error: 'no cwd' }); return }
      const svc = createWorktreeService({
        notify: (ev) => send({ type: 'worktree:changed', ...ev }),
      })
      const r = await svc.remove({
        cwd,
        worktreePath: msg.worktreePath,
        force: msg.force === true,
        hostSessionId: msg.sessionId,
      })
      send({
        type: 'git:worktree:remove:result',
        sessionId: msg.sessionId,
        ok: r.ok,
        ...(r.error ? { error: r.error } : {}),
        ...(r.errorCode ? { errorCode: r.errorCode } : {}),
        ...(r.dirtySummary ? { dirtySummary: r.dirtySummary } : {}),
      })
      return
    }
    default:
      return
  }
}
