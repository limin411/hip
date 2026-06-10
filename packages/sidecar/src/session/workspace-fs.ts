import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { FsEntry } from '@hip/protocol'

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
}
const TEXT_EXT = new Set([
  '.md', '.markdown', '.txt', '.json', '.js', '.jsx', '.ts', '.tsx', '.html', '.htm', '.css',
  '.scss', '.less', '.yml', '.yaml', '.toml', '.xml', '.sh', '.py', '.rs', '.go', '.java', '.c',
  '.h', '.cpp', '.rb', '.php', '.sql', '.env', '.gitignore', '.lock', '.cfg', '.ini', '.csv',
])
const TEXT_CAP = 1024 * 1024 // 1 MB
const IMG_CAP = 5 * 1024 * 1024 // 5 MB

export type PreviewResult =
  | { content: string; encoding: 'utf8' | 'base64'; mimeType?: string; truncated?: boolean }
  | { error: string }

function within(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep)
}

/** Resolve `abs` and assert it stays within `cwd` lexically. Throws on escape (sandbox 2nd line of defense). */
export function resolveWithin(cwd: string, abs: string): string {
  const root = path.resolve(cwd)
  const target = path.resolve(abs)
  if (!within(root, target)) {
    throw new Error(`path escapes project root: ${abs}`)
  }
  return target
}

/**
 * Lexical `resolveWithin` plus a symlink-aware check: if the resolved path exists,
 * its real (symlink-followed) location must also stay within the real project root.
 * Closes the read-path leak where an in-cwd symlink points outside the workspace.
 */
async function resolveRealWithin(cwd: string, abs: string): Promise<string> {
  const target = resolveWithin(cwd, abs)
  let realRoot: string
  let realTarget: string
  try {
    realRoot = await fs.realpath(path.resolve(cwd))
    realTarget = await fs.realpath(target)
  } catch {
    // Path doesn't exist yet (or root unresolvable) — the lexical check already held.
    return target
  }
  if (!within(realRoot, realTarget)) {
    throw new Error(`path escapes project root via symlink: ${abs}`)
  }
  return target
}

/** List immediate children of `dirAbs` (non-recursive): dirs first, then alphabetical. */
export async function lsDir(cwd: string, dirAbs: string): Promise<FsEntry[]> {
  const dir = await resolveRealWithin(cwd, dirAbs)
  const dirents = await fs.readdir(dir, { withFileTypes: true })
  const entries: FsEntry[] = []
  for (const d of dirents) {
    const isDir = d.isDirectory()
    const full = path.join(dir, d.name)
    let size: number | undefined
    if (!isDir) {
      try { size = (await fs.stat(full)).size } catch { size = undefined }
    }
    entries.push({ name: d.name, path: full, isDir, size })
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  return entries
}

export async function readHead(file: string, n: number): Promise<Buffer> {
  const fh = await fs.open(file, 'r')
  try {
    const buf = Buffer.alloc(n)
    const { bytesRead } = await fh.read(buf, 0, n, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

/** Read a file for UI preview. Text → utf8 (capped+truncated); images → base64; else error. */
export async function readForPreview(cwd: string, abs: string): Promise<PreviewResult> {
  const file = await resolveRealWithin(cwd, abs)
  const ext = path.extname(file).toLowerCase()
  const stat = await fs.stat(file)
  if (stat.isDirectory()) return { error: 'is_directory' }

  if (ext in IMAGE_MIME) {
    if (stat.size > IMG_CAP) return { error: 'too_large' }
    const buf = await fs.readFile(file)
    return { content: buf.toString('base64'), encoding: 'base64', mimeType: IMAGE_MIME[ext] }
  }

  if (TEXT_EXT.has(ext) || ext === '') {
    const truncated = stat.size > TEXT_CAP
    const buf = truncated ? await readHead(file, TEXT_CAP) : await fs.readFile(file)
    if (buf.subarray(0, 8000).includes(0)) return { error: 'binary' } // NUL byte → treat as binary
    const mimeType =
      ext === '.html' || ext === '.htm' ? 'text/html'
      : ext === '.md' || ext === '.markdown' ? 'text/markdown'
      : 'text/plain'
    return { content: buf.toString('utf8'), encoding: 'utf8', mimeType, truncated }
  }

  return { error: 'binary' }
}
