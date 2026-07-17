/**
 * File-backed worktree meta store (KD7).
 * Path: `<getWorktreesDir()>/.meta/<repoKey>.json`
 * Atomic write: temp sibling + rename.
 * @see docs/design/2026-07-17-worktree-studio-orca-alignment.md
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
  chmodSync,
} from 'node:fs'
import * as path from 'node:path'
import type { WorktreeId, WorktreeMetaFile, WorktreeRecord } from '@hip/protocol'
import { getWorktreesDir } from './worktree-config.js'

const HASH_SLICE = 16

/** Resolve realpath when possible; fall back to path.resolve. */
function resolvePath(p: string): string {
  const resolved = path.resolve(p)
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
}

/** Meta directory under the managed worktrees root. */
export function getWorktreeMetaDir(): string {
  return path.join(getWorktreesDir(), '.meta')
}

/** Absolute path for a repo's meta JSON file. */
export function metaPathForRepo(repoKey: string): string {
  return path.join(getWorktreeMetaDir(), `${repoKey}.json`)
}

/**
 * Stable repo key from a resolved identity path (git-common-dir preferred, else main path).
 * Uses sha256(...).slice(0, 16) — design originally said sha1; impl is sha256 (stable once shipped).
 * KD7 / KD15.
 */
export function repoKeyFromPrimary(primaryPath: string): string {
  return createHash('sha256').update(resolvePath(primaryPath), 'utf8').digest('hex').slice(0, HASH_SLICE)
}

/**
 * Stable worktree id for a path within a repo (KD15).
 * sha256(repoKey + '\\0' + realpath).slice(0, 16) — stable across restarts, not across path moves.
 */
export function worktreeIdFromPath(repoKey: string, worktreePath: string): WorktreeId {
  const resolved = resolvePath(worktreePath)
  return createHash('sha256').update(`${repoKey}\0${resolved}`, 'utf8').digest('hex').slice(0, HASH_SLICE)
}

/** Load meta file for a repo; returns null if missing or invalid. */
export function loadMeta(repoKey: string): WorktreeMetaFile | null {
  const file = metaPathForRepo(repoKey)
  if (!existsSync(file)) return null
  try {
    const raw = readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as WorktreeMetaFile
    if (parsed?.version !== 1 || parsed.repoKey !== repoKey || typeof parsed.records !== 'object') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** Atomic write of meta file (temp + rename). Mode 0o600 best-effort. */
export function saveMeta(meta: WorktreeMetaFile): void {
  const file = metaPathForRepo(meta.repoKey)
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  const body = JSON.stringify(meta, null, 2) + '\n'
  writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file)
  try {
    chmodSync(file, 0o600)
  } catch {
    // best-effort
  }
}

/** Upsert one record (without live branch/head/dirty) into meta and save. */
export function upsertMetaRecord(
  repoKey: string,
  primaryPath: string,
  record: Omit<WorktreeRecord, 'branch' | 'head' | 'dirty'>,
): WorktreeMetaFile {
  const existing = loadMeta(repoKey)
  const meta: WorktreeMetaFile = existing ?? {
    version: 1,
    repoKey,
    primaryPath,
    records: {},
  }
  meta.primaryPath = primaryPath
  meta.records[record.id] = record
  saveMeta(meta)
  return meta
}

/** Remove a record by id; no-op if missing. */
export function removeMetaRecord(repoKey: string, worktreeId: WorktreeId): WorktreeMetaFile | null {
  const meta = loadMeta(repoKey)
  if (!meta || !meta.records[worktreeId]) return meta
  delete meta.records[worktreeId]
  saveMeta(meta)
  return meta
}
