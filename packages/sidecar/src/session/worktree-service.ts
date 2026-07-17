/**
 * WorktreeService — single create/list/remove pipeline for product worktrees (KD2/4/5/14).
 * Handler notify wires `worktree:changed`; tool DI lands in PR3.
 * @see docs/design/2026-07-17-worktree-studio-orca-alignment.md
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpathSync } from 'node:fs'
import * as path from 'node:path'
import type {
  WorktreeChangeKind,
  WorktreeInfo,
  WorktreeRecord,
  WorktreeSource,
} from '@hip/protocol'
import { getWorktreesDir } from './worktree-config.js'
import { computeManagedWorktreePath, ensurePathWithinWorkspace } from './worktree-paths.js'
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
} from './workspace-git.js'
import {
  loadMeta,
  removeMetaRecord,
  repoKeyFromPrimary,
  upsertMetaRecord,
  worktreeIdFromPath,
} from './worktree-meta.js'

const execFileP = promisify(execFile)

const EPHEMERAL_BRANCH_RE = /^hip-bg-/i

export type WorktreeChangedNotify = (event: {
  sessionId?: string
  repoKey: string
  kind: WorktreeChangeKind
  worktree: WorktreeRecord
  reveal?: boolean
}) => void

export interface WorktreeServiceOpts {
  /** Optional: absent in unit tests / headless CLI still OK for disk ops. */
  notify?: WorktreeChangedNotify
  /** Override nest; when omitted, HIP_WORKTREES_NEST===1 only (default false until PR2b). */
  nestByRepo?: boolean
}

export interface CreateWorktreeServiceOpts {
  cwd: string
  branch: string
  pathKey?: string
  source: WorktreeSource
  hostSessionId?: string
  ephemeral?: boolean
  parallelRunId?: string
  taskId?: string
  label?: string
  /** Default true on product creates. */
  reveal?: boolean
}

export interface ListWorktreeServiceOpts {
  cwd: string
  /** Default true: only managed (+ primary). */
  managedOnly?: boolean
  /** Default true for Studio: hide meta.ephemeral / hip-bg-* branches (KD14). */
  hideEphemeral?: boolean
}

export interface RemoveWorktreeServiceOpts {
  cwd: string
  worktreePath: string
  /** PR6 adds preflight; today always force via removeWorktree. */
  force?: boolean
  hostSessionId?: string
}

/** KD14: ephemeral if meta.ephemeral OR branch /^hip-bg-/i — NOT path depth. */
export function isEphemeralWorktree(
  record: Pick<WorktreeRecord, 'branch' | 'ephemeral'> | Pick<WorktreeInfo, 'branch' | 'ephemeral'>,
): boolean {
  if (record.ephemeral === true) return true
  if (record.branch && EPHEMERAL_BRANCH_RE.test(record.branch)) return true
  return false
}

function nestByRepoFromEnv(): boolean {
  return process.env.HIP_WORKTREES_NEST?.trim() === '1'
}

function resolvePreferReal(p: string): string {
  const resolved = path.resolve(p)
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
}

function isUnderManagedDir(worktreePath: string, worktreesDir: string): boolean {
  const resolved = resolvePreferReal(worktreePath)
  const dir = resolvePreferReal(worktreesDir)
  return resolved === dir || resolved.startsWith(dir + path.sep)
}

async function resolveGitToplevel(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function resolveHead(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], {
      cwd,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    })
    return stdout.trim()
  } catch {
    return ''
  }
}

function pathsEqual(a: string, b: string): boolean {
  return resolvePreferReal(a) === resolvePreferReal(b)
}

export interface WorktreeService {
  create(opts: CreateWorktreeServiceOpts): Promise<{ ok: boolean; path?: string; worktree?: WorktreeRecord; error?: string }>
  list(opts: ListWorktreeServiceOpts): Promise<{ ok: boolean; worktrees: WorktreeInfo[]; error?: string }>
  remove(opts: RemoveWorktreeServiceOpts): Promise<{ ok: boolean; error?: string }>
}

export function createWorktreeService(opts: WorktreeServiceOpts = {}): WorktreeService {
  const notify = opts.notify
  const nestOverride = opts.nestByRepo

  return {
    async create(createOpts) {
      const { cwd, branch, pathKey, source } = createOpts
      const nestByRepo = nestOverride ?? nestByRepoFromEnv()
      const worktreesDir = getWorktreesDir()
      const primaryPath = (await resolveGitToplevel(cwd)) ?? path.resolve(cwd)
      const repoKey = repoKeyFromPrimary(primaryPath)

      let worktreePath: string
      try {
        worktreePath = computeManagedWorktreePath({
          worktreesDir,
          pathKey,
          branch,
          gitRoot: primaryPath,
          nestByRepo,
        })
        worktreePath = ensurePathWithinWorkspace(worktreePath, worktreesDir)
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }

      const r = await createWorktree(cwd, branch, worktreePath)
      if (!r.ok) return { ok: false, error: r.error }

      // Keep the path under HIP_WORKTREES_DIR as returned by createWorktree (not
      // realpath). removeWorktree gates on path.resolve prefix without realpath
      // (PR6 upgrades that); realpath is used only for stable ids + list merge.
      const absPath = r.path ?? worktreePath
      const head = (await resolveHead(absPath)) || (await resolveHead(cwd))
      const id = worktreeIdFromPath(repoKey, absPath)
      const createdAt = Date.now()
      const label =
        createOpts.label?.trim() ||
        branch ||
        path.basename(absPath)

      const metaRecord: Omit<WorktreeRecord, 'branch' | 'head' | 'dirty'> = {
        id,
        path: absPath,
        repoKey,
        isPrimary: false,
        managed: true,
        ephemeral: createOpts.ephemeral === true,
        source,
        label,
        pathKey: pathKey ?? branch,
        createdAt,
        hostSessionId: createOpts.hostSessionId,
        taskId: createOpts.taskId,
        parallelRunId: createOpts.parallelRunId,
        lastSeenAt: createdAt,
      }
      upsertMetaRecord(repoKey, primaryPath, metaRecord)

      const record: WorktreeRecord = {
        ...metaRecord,
        branch,
        head,
      }

      notify?.({
        sessionId: createOpts.hostSessionId,
        repoKey,
        kind: 'created',
        worktree: record,
        reveal: createOpts.reveal ?? true,
      })

      return { ok: true, path: absPath, worktree: record }
    },

    async list(listOpts) {
      const { cwd } = listOpts
      const managedOnly = listOpts.managedOnly !== false
      const hideEphemeral = listOpts.hideEphemeral !== false
      const worktreesDir = getWorktreesDir()

      const porcelain = await listWorktrees(cwd)
      if (!porcelain.ok || !porcelain.worktrees) {
        return { ok: false, worktrees: [], error: porcelain.error }
      }

      const primaryPath = (await resolveGitToplevel(cwd)) ?? porcelain.worktrees[0]?.path ?? path.resolve(cwd)
      const repoKey = repoKeyFromPrimary(primaryPath)
      const meta = loadMeta(repoKey)
      const metaByPath = new Map<string, Omit<WorktreeRecord, 'branch' | 'head' | 'dirty'>>()
      if (meta) {
        for (const rec of Object.values(meta.records)) {
          metaByPath.set(resolvePreferReal(rec.path), rec)
        }
      }

      const primaryResolved = resolvePreferReal(primaryPath)
      const out: WorktreeInfo[] = []

      for (let i = 0; i < porcelain.worktrees.length; i++) {
        const wt = porcelain.worktrees[i]!
        const resolved = resolvePreferReal(wt.path)
        const managed = isUnderManagedDir(resolved, worktreesDir)
        // Primary: matches git toplevel, or first porcelain entry when toplevel unknown
        const isPrimary = pathsEqual(resolved, primaryResolved) || (i === 0 && !managed)
        const metaRec = metaByPath.get(resolved)
        const id = metaRec?.id ?? worktreeIdFromPath(repoKey, resolved)
        const ephemeral =
          metaRec?.ephemeral === true || EPHEMERAL_BRANCH_RE.test(wt.branch)
        const source: WorktreeSource =
          metaRec?.source ?? (isPrimary ? 'primary' : 'discovered')

        if (managedOnly && !managed && !isPrimary) continue
        if (hideEphemeral && isEphemeralWorktree({ branch: wt.branch, ephemeral })) {
          continue
        }

        out.push({
          path: wt.path,
          branch: wt.branch,
          head: wt.head,
          id,
          managed,
          isPrimary,
          ephemeral: ephemeral || undefined,
          source,
          label: metaRec?.label ?? (wt.branch || path.basename(resolved)),
          repoKey,
        })
      }

      return { ok: true, worktrees: out }
    },

    async remove(removeOpts) {
      const { cwd, worktreePath } = removeOpts
      // Resolve id/meta while the path still exists (realpath needs it for KD15 stability).
      const primaryPath = (await resolveGitToplevel(cwd)) ?? path.resolve(cwd)
      const repoKey = repoKeyFromPrimary(primaryPath)
      const id = worktreeIdFromPath(repoKey, worktreePath)
      const meta = loadMeta(repoKey)
      const metaRec = meta?.records[id]

      const r = await removeWorktree(cwd, worktreePath)
      if (!r.ok) return { ok: false, error: r.error }

      removeMetaRecord(repoKey, id)

      const record: WorktreeRecord = {
        id,
        path: worktreePath,
        branch: '',
        head: '',
        repoKey,
        isPrimary: false,
        managed: true,
        ephemeral: metaRec?.ephemeral,
        source: metaRec?.source ?? 'protocol',
        label: metaRec?.label,
        pathKey: metaRec?.pathKey,
        createdAt: metaRec?.createdAt,
        hostSessionId: metaRec?.hostSessionId ?? removeOpts.hostSessionId,
        taskId: metaRec?.taskId,
        parallelRunId: metaRec?.parallelRunId,
      }

      notify?.({
        sessionId: removeOpts.hostSessionId,
        repoKey,
        kind: 'removed',
        worktree: record,
      })

      return { ok: true }
    },
  }
}
