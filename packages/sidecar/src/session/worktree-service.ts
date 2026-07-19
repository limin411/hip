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
  WorktreeMetaFile,
  WorktreeRecord,
  WorktreeRemoveErrorCode,
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
import { assertWorktreeCleanForRemoval, WorktreeDirtyError } from './worktree-preflight.js'

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

/**
 * Nest-by-repo for new creates (PR2b): default **on** when env unset.
 * Escape: HIP_WORKTREES_NEST=0 (or false/off/no).
 * Explicit on: HIP_WORKTREES_NEST=1 (or true/on/yes).
 */
function nestByRepoFromEnv(): boolean {
  const v = process.env.HIP_WORKTREES_NEST?.trim().toLowerCase()
  if (v === undefined || v === '') return true
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true
  return true
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

function pathsEqual(a: string, b: string): boolean {
  return resolvePreferReal(a) === resolvePreferReal(b)
}

/**
 * Absolute git common dir for the repo containing `cwd`.
 * Stable across linked worktrees (unlike --show-toplevel).
 */
async function resolveGitCommonDir(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    })
    const raw = stdout.trim()
    if (!raw) return null
    const abs = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw)
    return resolvePreferReal(abs)
  } catch {
    return null
  }
}

/**
 * Stable main worktree + repoKey for any cwd in the repo (including linked worktrees).
 * - primaryPath: first porcelain entry (git always lists main first), or override
 * - repoKey: hash of realpath(git-common-dir) when available, else primaryPath
 *
 * Pass `primaryPathHint` (e.g. porcelain[0].path) to avoid a second `git worktree list`.
 */
export async function resolveRepoBinding(
  cwd: string,
  primaryPathHint?: string | null,
): Promise<{ primaryPath: string; repoKey: string }> {
  let primaryFromList = primaryPathHint?.trim() || null
  if (!primaryFromList) {
    const porcelain = await listWorktrees(cwd)
    primaryFromList = porcelain.ok && porcelain.worktrees?.[0]?.path
      ? porcelain.worktrees[0].path
      : null
  }

  const commonDir = await resolveGitCommonDir(cwd)
  const primaryPath = primaryFromList ?? path.resolve(cwd)
  // Prefer common-dir for stable repoKey across main/linked cwd (design Data Model).
  const keyBase = commonDir ?? resolvePreferReal(primaryPath)
  const repoKey = repoKeyFromPrimary(keyBase)
  return { primaryPath, repoKey }
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

/** Prefer id-from-path; fall back to path scan so remove still cleans orphaned keys. */
function findMetaRecord(
  meta: WorktreeMetaFile | null,
  repoKey: string,
  worktreePath: string,
): { id: string; rec: Omit<WorktreeRecord, 'branch' | 'head' | 'dirty'> } | null {
  if (!meta) return null
  const id = worktreeIdFromPath(repoKey, worktreePath)
  if (meta.records[id]) return { id, rec: meta.records[id]! }
  for (const [rid, rec] of Object.entries(meta.records)) {
    if (pathsEqual(rec.path, worktreePath)) return { id: rid, rec }
  }
  return null
}

export type RemoveWorktreeServiceResult = {
  ok: boolean
  error?: string
  errorCode?: WorktreeRemoveErrorCode
  /** Porcelain status when errorCode is WORKTREE_DIRTY. */
  dirtySummary?: string
}

/** Map workspace-git / preflight remove failures to structured error codes (PR7). */
export function mapRemoveError(error?: string): {
  errorCode: WorktreeRemoveErrorCode
  error: string
} {
  const msg = (error ?? '').trim() || 'remove failed'
  const lower = msg.toLowerCase()
  if (lower.includes('outside managed') || lower.includes('not managed')) {
    return { errorCode: 'NOT_MANAGED', error: msg }
  }
  // Missing git binary is tooling/env failure — not a missing worktree path.
  // workspace-git returns the literal "git not found"; do not match bare "not found".
  if (lower.includes('git not found')) {
    return { errorCode: 'UNKNOWN', error: msg }
  }
  if (
    lower.includes('worktree not found') ||
    lower.includes('not a working tree') ||
    lower.includes('no such')
  ) {
    return { errorCode: 'NOT_FOUND', error: msg }
  }
  if (lower.includes('dirty') || lower.includes('uncommitted')) {
    return { errorCode: 'WORKTREE_DIRTY', error: msg }
  }
  return { errorCode: 'UNKNOWN', error: msg }
}

export interface WorktreeService {
  create(opts: CreateWorktreeServiceOpts): Promise<{ ok: boolean; path?: string; worktree?: WorktreeRecord; error?: string }>
  list(opts: ListWorktreeServiceOpts): Promise<{ ok: boolean; worktrees: WorktreeInfo[]; error?: string }>
  remove(opts: RemoveWorktreeServiceOpts): Promise<RemoveWorktreeServiceResult>
}

export function createWorktreeService(opts: WorktreeServiceOpts = {}): WorktreeService {
  const notify = opts.notify
  const nestOverride = opts.nestByRepo

  return {
    async create(createOpts) {
      const { cwd, branch, pathKey, source } = createOpts
      const nestByRepo = nestOverride ?? nestByRepoFromEnv()
      const worktreesDir = getWorktreesDir()
      const { primaryPath, repoKey } = await resolveRepoBinding(cwd)

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

      // Main = porcelain[0]; repoKey from common-dir (stable for linked cwd).
      const { primaryPath, repoKey } = await resolveRepoBinding(cwd, porcelain.worktrees[0]?.path)
      const meta = loadMeta(repoKey)
      const metaByPath = new Map<string, Omit<WorktreeRecord, 'branch' | 'head' | 'dirty'>>()
      if (meta) {
        for (const rec of Object.values(meta.records)) {
          metaByPath.set(resolvePreferReal(rec.path), rec)
        }
      }

      const primaryResolved = resolvePreferReal(primaryPath)
      const out: WorktreeInfo[] = []

      for (const wt of porcelain.worktrees) {
        const resolved = resolvePreferReal(wt.path)
        const managed = isUnderManagedDir(resolved, worktreesDir)
        // Single primary: only the main worktree path (not linked cwd toplevel).
        const isPrimary = pathsEqual(resolved, primaryResolved)
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
      const { repoKey } = await resolveRepoBinding(cwd)
      const meta = loadMeta(repoKey)
      const found = findMetaRecord(meta, repoKey, worktreePath)
      const id = found?.id ?? worktreeIdFromPath(repoKey, worktreePath)
      const metaRec = found?.rec

      // H4: dirty preflight before git remove / PTY teardown (force skips).
      try {
        await assertWorktreeCleanForRemoval(worktreePath, removeOpts.force === true)
      } catch (e) {
        // Duck-type code as well as instanceof (bundler/duplicate-class safe).
        const dirty =
          e instanceof WorktreeDirtyError ||
          (e !== null &&
            typeof e === 'object' &&
            (e as { code?: string }).code === 'WORKTREE_DIRTY')
        if (dirty) {
          const dirtySummary =
            e instanceof WorktreeDirtyError
              ? e.statusOutput
              : typeof e === 'object' && e !== null && typeof (e as { statusOutput?: string }).statusOutput === 'string'
                ? (e as { statusOutput: string }).statusOutput
                : undefined
          return {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            errorCode: 'WORKTREE_DIRTY',
            ...(dirtySummary ? { dirtySummary } : {}),
          }
        }
        throw e
      }

      // Product default: preflight (force false). Bg / explicit cleanup pass force: true.
      const r = await removeWorktree(cwd, worktreePath, 'git', removeOpts.force === true)
      if (!r.ok) {
        const mapped = mapRemoveError(r.error)
        return { ok: false, error: mapped.error, errorCode: mapped.errorCode }
      }

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
