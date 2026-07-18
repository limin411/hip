import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { MemoryFileConfig, MemoryItem, MemoryKind } from '@hip/protocol'
import type { MemoryStore } from './store.js'

/** Root of markdown mirrors. Override with `HIP_MEMORIES_DIR` (tests). */
export function memoriesRootDir(override?: string): string {
  if (override?.trim()) return override.trim()
  const fromEnv = process.env.HIP_MEMORIES_DIR?.trim()
  if (fromEnv) return fromEnv
  return join(homedir(), '.hip', 'memories')
}

export function globalMemoryMirrorPath(root?: string): string {
  return join(memoriesRootDir(root), 'global', 'MEMORY.md')
}

export function projectMemoryMirrorPath(projectKeyHash: string, root?: string): string {
  return join(memoriesRootDir(root), 'projects', projectKeyHash, 'MEMORY.md')
}

export function globalUserMirrorPath(root?: string): string {
  return join(memoriesRootDir(root), 'global', 'USER.md')
}

/**
 * Atomic write: write temp sibling then rename.
 * Mode 0o600 on the final file best-effort.
 */
export function atomicWriteFile(targetPath: string, content: string): void {
  mkdirSync(dirname(targetPath), { recursive: true })
  const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, targetPath)
  try {
    chmodSync(targetPath, 0o600)
  } catch {
    // best-effort; some platforms ignore mode
  }
}

/** Build markdown body from summary + active items. */
export function formatMemoryMirrorMarkdown(
  summaryMd: string | undefined,
  items: MemoryItem[],
): string {
  const parts: string[] = ['# MEMORY', '']
  if (summaryMd?.trim()) {
    parts.push('## Summary', '', summaryMd.trim(), '')
  }
  if (items.length > 0) {
    parts.push('## Items', '')
    for (const it of items) {
      parts.push(`### ${it.title}`, '')
      parts.push(`<!-- id: ${it.id} | kind: ${it.kind} | conf: ${it.confidence} -->`, '')
      parts.push(it.content.trim(), '')
    }
  }
  return `${parts.join('\n').trimEnd()}\n`
}

const ITEM_META_RE =
  /<!--\s*id:\s*([^|]+?)\s*\|\s*kind:\s*([^|]+?)\s*\|\s*conf:\s*([0-9.]+)\s*-->/

export type ParsedMirrorItem = {
  id: string
  title: string
  content: string
  kind: MemoryKind
  confidence: number
}

/** Parse a MEMORY.md mirror body into summary + items (best-effort). */
export function parseMemoryMirrorMarkdown(md: string): {
  summaryMd?: string
  items: ParsedMirrorItem[]
} {
  const text = md.replace(/\r\n/g, '\n')
  let summaryMd: string | undefined
  const summaryMatch = text.match(/## Summary\n+([\s\S]*?)(?=\n## Items|\n### |$)/)
  if (summaryMatch) {
    const s = summaryMatch[1].trim()
    if (s) summaryMd = s
  }

  const items: ParsedMirrorItem[] = []
  const itemSections = text.split(/\n### /).slice(1)
  for (const section of itemSections) {
    const lines = section.split('\n')
    const title = (lines[0] ?? '').trim()
    if (!title) continue
    const body = lines.slice(1).join('\n')
    const meta = body.match(ITEM_META_RE)
    if (!meta) continue
    const id = meta[1].trim()
    const kind = meta[2].trim() as MemoryKind
    const confidence = Number(meta[3])
    const content = body
      .replace(ITEM_META_RE, '')
      .replace(/^\s+/, '')
      .trim()
    if (!id || !content) continue
    items.push({
      id,
      title,
      content,
      kind: kind || 'lesson',
      confidence: Number.isFinite(confidence) ? confidence : 0.7,
    })
  }
  return { summaryMd, items }
}

export type WriteMemoryMirrorOpts = {
  store: MemoryStore
  config: MemoryFileConfig
  /** When set, write project mirror; else global. */
  projectKeyHash?: string
  summaryMd?: string
  /** Override memories root (also honored via HIP_MEMORIES_DIR). */
  memoriesDir?: string
}

/**
 * Write MEMORY.md mirror when `exportMarkdownMirror` is true.
 * Global path: `~/.hip/memories/global/MEMORY.md`
 * Project path: `~/.hip/memories/projects/<hash>/MEMORY.md`
 */
export function writeMemoryMirror(opts: WriteMemoryMirrorOpts): string | null {
  if (!opts.config.exportMarkdownMirror) return null

  const root = opts.memoriesDir
  let path: string
  let items: MemoryItem[]
  let summary = opts.summaryMd

  if (opts.projectKeyHash) {
    path = projectMemoryMirrorPath(opts.projectKeyHash, root)
    items = opts.store.listItems({
      scope: 'project',
      projectKeyHash: opts.projectKeyHash,
      status: 'active',
      limit: 10_000,
    })
    if (summary === undefined) {
      summary = opts.store.getSummary(`summary:project:${opts.projectKeyHash}`)?.summaryMd
    }
  } else {
    path = globalMemoryMirrorPath(root)
    items = opts.store.listItems({
      scope: 'global',
      status: 'active',
      limit: 10_000,
    })
    if (summary === undefined) {
      summary = opts.store.getSummary('summary:global')?.summaryMd
    }
  }

  const md = formatMemoryMirrorMarkdown(summary, items)
  atomicWriteFile(path, md)
  return path
}

/** Scopes touched by a logical mutation. Always rewrite these mirrors from DB. */
export type MemoryMutationScopes = {
  global?: boolean
  projectKeyHashes?: string[]
  /** When true, rewrite global + every project hash known in DB or on disk. */
  all?: boolean
}

export type RewriteMirrorsFromDbOpts = {
  store: MemoryStore
  config: MemoryFileConfig
  scopes?: MemoryMutationScopes
  memoriesDir?: string
}

/**
 * Rewrite mirrors from SQLite (DB is SoT).
 * When `exportMarkdownMirror` is false, returns skipped without disk I/O.
 */
export function rewriteMirrorsFromDb(opts: RewriteMirrorsFromDbOpts): {
  written: string[]
  skipped: boolean
} {
  if (!opts.config.exportMarkdownMirror) {
    return { written: [], skipped: true }
  }

  const root = opts.memoriesDir
  const written: string[] = []
  const scopes = opts.scopes ?? { all: true }

  const doGlobal = scopes.all || scopes.global
  const projectHashes = new Set<string>(scopes.projectKeyHashes ?? [])

  if (scopes.all) {
    for (const h of listKnownProjectKeyHashes(opts.store, root)) {
      projectHashes.add(h)
    }
  }

  if (doGlobal) {
    try {
      const p = writeMemoryMirror({
        store: opts.store,
        config: opts.config,
        memoriesDir: root,
      })
      if (p) written.push(p)
    } catch (err) {
      console.warn(
        '[memory-mirror] global rewrite failed',
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  for (const hash of projectHashes) {
    if (!hash) continue
    try {
      const p = writeMemoryMirror({
        store: opts.store,
        config: opts.config,
        projectKeyHash: hash,
        memoriesDir: root,
      })
      if (p) written.push(p)
    } catch (err) {
      console.warn(
        '[memory-mirror] project rewrite failed',
        hash,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  return { written, skipped: false }
}

/** Project key hashes from DB active/archived project items + on-disk project dirs. */
export function listKnownProjectKeyHashes(
  store: MemoryStore,
  memoriesDir?: string,
): string[] {
  const hashes = new Set<string>()
  for (const h of store.listDistinctProjectKeyHashes()) {
    if (h) hashes.add(h)
  }
  const root = memoriesRootDir(memoriesDir)
  const projectsDir = join(root, 'projects')
  try {
    if (existsSync(projectsDir)) {
      for (const name of readdirSync(projectsDir)) {
        if (name && !name.startsWith('.')) hashes.add(name)
      }
    }
  } catch {
    // best-effort
  }
  return [...hashes]
}

export type DetectMirrorDesyncOpts = {
  store: MemoryStore
  projectKeyHash?: string
  memoriesDir?: string
}

export type MirrorDesyncResult = {
  inSync: boolean
  mirrorOnlyIds: string[]
  dbOnlyIds: string[]
  mirrorPath: string
}

/** Compare active item ids in DB vs mirror for one scope. */
export function detectMirrorDesync(opts: DetectMirrorDesyncOpts): MirrorDesyncResult {
  const path = opts.projectKeyHash
    ? projectMemoryMirrorPath(opts.projectKeyHash, opts.memoriesDir)
    : globalMemoryMirrorPath(opts.memoriesDir)

  const dbItems = opts.projectKeyHash
    ? opts.store.listItems({
        scope: 'project',
        projectKeyHash: opts.projectKeyHash,
        status: 'active',
        limit: 10_000,
      })
    : opts.store.listItems({ scope: 'global', status: 'active', limit: 10_000 })

  const dbIds = new Set(dbItems.map((i) => i.id))
  let mirrorIds = new Set<string>()
  if (existsSync(path)) {
    try {
      const parsed = parseMemoryMirrorMarkdown(readFileSync(path, 'utf8'))
      mirrorIds = new Set(parsed.items.map((i) => i.id))
    } catch {
      mirrorIds = new Set()
    }
  }

  const mirrorOnlyIds: string[] = []
  const dbOnlyIds: string[] = []
  for (const id of mirrorIds) {
    if (!dbIds.has(id)) mirrorOnlyIds.push(id)
  }
  for (const id of dbIds) {
    if (!mirrorIds.has(id)) dbOnlyIds.push(id)
  }

  return {
    inSync: mirrorOnlyIds.length === 0 && dbOnlyIds.length === 0,
    mirrorOnlyIds,
    dbOnlyIds,
    mirrorPath: path,
  }
}

export type ImportFromMirrorOpts = {
  store: MemoryStore
  /** When set, import project mirror; else global. */
  projectKeyHash?: string
  conflict?: 'keep' | 'overwrite'
  memoriesDir?: string
  /** Optional project key string for new project items. */
  projectKey?: string
}

/**
 * Import items from a MEMORY.md under the memories root into SQLite.
 * Paths are restricted to memoriesRootDir (never cwd MEMORY.md).
 */
export function importFromMirror(opts: ImportFromMirrorOpts): {
  imported: number
  skipped: number
} {
  const root = resolve(memoriesRootDir(opts.memoriesDir))
  const path = resolve(
    opts.projectKeyHash
      ? projectMemoryMirrorPath(opts.projectKeyHash, opts.memoriesDir)
      : globalMemoryMirrorPath(opts.memoriesDir),
  )
  if (!path.startsWith(root + '/') && path !== root) {
    throw new Error('importFromMirror: path escapes memories root')
  }
  if (!existsSync(path)) {
    return { imported: 0, skipped: 0 }
  }

  const { items, summaryMd } = parseMemoryMirrorMarkdown(readFileSync(path, 'utf8'))
  let imported = 0
  let skipped = 0
  const conflict = opts.conflict ?? 'keep'
  const now = Date.now()

  for (const raw of items) {
    const existing = opts.store.getItem(raw.id)
    if (existing) {
      if (conflict === 'keep') {
        skipped += 1
        continue
      }
    }
    const item: MemoryItem = {
      id: raw.id,
      scope: opts.projectKeyHash ? 'project' : 'global',
      projectKey: opts.projectKeyHash ? opts.projectKey : undefined,
      projectKeyHash: opts.projectKeyHash,
      kind: raw.kind,
      title: raw.title,
      content: raw.content,
      confidence: raw.confidence,
      status: 'active',
      source: 'import',
      tags: [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      useCount: existing?.useCount ?? 0,
      pinned: existing?.pinned ?? false,
    }
    opts.store.upsertItem(item)
    imported += 1
  }

  if (summaryMd?.trim()) {
    const sumId = opts.projectKeyHash
      ? `summary:project:${opts.projectKeyHash}`
      : 'summary:global'
    opts.store.upsertSummary({
      id: sumId,
      scope: opts.projectKeyHash ? 'project' : 'global',
      projectKeyHash: opts.projectKeyHash,
      projectKey: opts.projectKey,
      summaryMd: summaryMd.trim(),
      updatedAt: now,
    })
  }

  return { imported, skipped }
}

/** Write USER.md from global profile items. */
export function writeUserProfileMirror(opts: {
  store: MemoryStore
  config: MemoryFileConfig
  memoriesDir?: string
}): string | null {
  if (!opts.config.exportMarkdownMirror) return null
  const profiles = opts.store
    .listItems({ scope: 'global', status: 'active', limit: 10_000 })
    .filter((i) => i.kind === 'profile')
  const parts = ['# USER', '']
  if (profiles.length === 0) {
    parts.push('_No profile memories yet._', '')
  } else {
    for (const it of profiles) {
      parts.push(`### ${it.title}`, '')
      parts.push(`<!-- id: ${it.id} | kind: ${it.kind} | conf: ${it.confidence} -->`, '')
      parts.push(it.content.trim(), '')
    }
  }
  const path = globalUserMirrorPath(opts.memoriesDir)
  atomicWriteFile(path, `${parts.join('\n').trimEnd()}\n`)
  return path
}
