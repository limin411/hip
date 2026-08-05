/**
 * Git worktree isolation for parallel agent tasks (plan M3).
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface IsolationInfo {
  id: string
  path: string
  branch: string
  createdAt: number
  sessionId: string
  projectHash: string
}

export interface IsolationCreateResult {
  ok: boolean
  worktree?: IsolationInfo
  error?: string
}

const MAX_PER_PROJECT = 8

function projectHash(repoPath: string): string {
  return createHash('sha256').update(repoPath).digest('hex').slice(0, 12)
}

function isolationRoot(): string {
  return join(homedir(), '.hip', 'isolation')
}

function metaPath(projectHash: string): string {
  return join(isolationRoot(), projectHash, 'meta.json')
}

function loadMeta(projectHash: string): IsolationInfo[] {
  const p = metaPath(projectHash)
  if (!existsSync(p)) return []
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as IsolationInfo[]
  } catch {
    return []
  }
}

function saveMeta(projectHash: string, rows: IsolationInfo[]): void {
  const dir = join(isolationRoot(), projectHash)
  mkdirSync(dir, { recursive: true })
  writeFileSync(metaPath(projectHash), JSON.stringify(rows, null, 2))
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  }).trimEnd()
}

function tryGit(cwd: string, args: string[]): { ok: true; out: string } | { ok: false; error: string } {
  try {
    return { ok: true, out: runGit(cwd, args) }
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string }
    return { ok: false, error: String(err.stderr || err.message || e) }
  }
}

export function listIsolations(repoPath: string): IsolationInfo[] {
  return loadMeta(projectHash(repoPath))
}

export function createIsolation(input: {
  repoPath: string
  sessionId: string
  name?: string
  baseRef?: string
}): IsolationCreateResult {
  const inside = tryGit(input.repoPath, ['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok || inside.out !== 'true') {
    return { ok: false, error: 'not a git repository' }
  }

  const ph = projectHash(input.repoPath)
  let rows = loadMeta(ph).filter((r) => existsSync(r.path))
  if (rows.length >= MAX_PER_PROJECT) {
    // drop oldest
    const oldest = [...rows].sort((a, b) => a.createdAt - b.createdAt)[0]
    if (oldest) {
      discardIsolation({ repoPath: input.repoPath, worktreeId: oldest.id })
      rows = loadMeta(ph).filter((r) => existsSync(r.path))
    }
  }

  const id = `wt-${randomBytes(4).toString('hex')}`
  const branch = `hip/iso/${input.sessionId.slice(0, 8)}-${id}`
  const path = join(isolationRoot(), ph, id)
  mkdirSync(join(isolationRoot(), ph), { recursive: true })

  const base = input.baseRef || 'HEAD'
  const add = tryGit(input.repoPath, ['worktree', 'add', '-b', branch, path, base])
  if (!add.ok) {
    return { ok: false, error: add.error }
  }

  const info: IsolationInfo = {
    id,
    path,
    branch,
    createdAt: Date.now(),
    sessionId: input.sessionId,
    projectHash: ph,
  }
  rows.push(info)
  saveMeta(ph, rows)
  return { ok: true, worktree: info }
}

export function discardIsolation(input: {
  repoPath: string
  worktreeId: string
}): { ok: boolean; error?: string } {
  const ph = projectHash(input.repoPath)
  const rows = loadMeta(ph)
  const hit = rows.find((r) => r.id === input.worktreeId)
  if (!hit) return { ok: false, error: 'worktree not found' }

  tryGit(input.repoPath, ['worktree', 'remove', '--force', hit.path])
  tryGit(input.repoPath, ['branch', '-D', hit.branch])
  if (existsSync(hit.path)) {
    try {
      rmSync(hit.path, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  saveMeta(
    ph,
    rows.filter((r) => r.id !== input.worktreeId),
  )
  return { ok: true }
}

/** Best-effort GC of isolations for a session. */
export function gcSessionIsolations(repoPath: string, sessionId: string): number {
  const rows = listIsolations(repoPath).filter((r) => r.sessionId === sessionId)
  let n = 0
  for (const r of rows) {
    if (discardIsolation({ repoPath, worktreeId: r.id }).ok) n++
  }
  return n
}

export function listAllIsolationDirs(): string[] {
  const root = isolationRoot()
  if (!existsSync(root)) return []
  const out: string[] = []
  for (const ph of readdirSync(root)) {
    const dir = join(root, ph)
    try {
      for (const id of readdirSync(dir)) {
        if (id === 'meta.json') continue
        out.push(join(dir, id))
      }
    } catch {
      /* ignore */
    }
  }
  return out
}
