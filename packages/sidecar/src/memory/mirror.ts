import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { MemoryFileConfig, MemoryItem } from '@hip/protocol'
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
