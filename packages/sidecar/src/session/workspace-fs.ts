import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { FsEntry } from '@hip/protocol'

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
}
const TEXT_CAP = 1024 * 1024 // 1 MB
const IMG_CAP = 5 * 1024 * 1024 // 5 MB
const PDF_CAP = 5 * 1024 * 1024 // 5 MB

/** Map extension → preview mime (only special cases; everything else is text/plain). */
function textMimeForExt(ext: string): string {
  if (ext === '.html' || ext === '.htm' || ext === '.xhtml') return 'text/html'
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return 'text/markdown'
  return 'text/plain'
}

/** True if the buffer looks binary (NUL in the sampled head). */
function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0)
}

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
export async function resolveRealWithin(cwd: string, abs: string): Promise<string> {
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
    if (d.name.startsWith('.')) continue // hide dotfiles/dot-dirs (.git, .env, …)
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

/** Resolve a preview path that may use EITHER convention: a real absolute path within the project
 *  (as fs:ls returns for the file tree), OR the file tools' root-relative form ("/index.html" =
 *  <root>/index.html, per write_file/read_file — what artifact cards carry). Tries the literal path
 *  first; if it escapes the root, retries the root-relative interpretation. Both go through
 *  resolveRealWithin, so the lexical jail + symlink guard still hold — a path that escapes under
 *  BOTH interpretations still throws. */
async function resolvePreviewPath(cwd: string, abs: string): Promise<string> {
  try {
    return await resolveRealWithin(cwd, abs)
  } catch {
    return await resolveRealWithin(cwd, path.join(cwd, abs.replace(/^[/\\]+/, '')))
  }
}

/**
 * Read a file for UI preview.
 * - images / PDF → base64 (size-capped)
 * - everything else → utf8 text (1 MB cap + truncate), unless the head contains a NUL
 *   (treated as binary). Code / config / markup of any extension therefore previews
 *   without an extension allowlist.
 */
export async function readForPreview(cwd: string, abs: string): Promise<PreviewResult> {
  const file = await resolvePreviewPath(cwd, abs)
  const ext = path.extname(file).toLowerCase()
  const stat = await fs.stat(file)
  if (stat.isDirectory()) return { error: 'is_directory' }

  if (ext in IMAGE_MIME) {
    if (stat.size > IMG_CAP) return { error: 'too_large' }
    const buf = await fs.readFile(file)
    return { content: buf.toString('base64'), encoding: 'base64', mimeType: IMAGE_MIME[ext] }
  }

  if (ext === '.pdf') {
    if (stat.size > PDF_CAP) return { error: 'too_large' }
    const buf = await fs.readFile(file)
    return { content: buf.toString('base64'), encoding: 'base64', mimeType: 'application/pdf' }
  }

  const truncated = stat.size > TEXT_CAP
  const buf = truncated ? await readHead(file, TEXT_CAP) : await fs.readFile(file)
  if (looksBinary(buf)) return { error: 'binary' }
  return {
    content: buf.toString('utf8'),
    encoding: 'utf8',
    mimeType: textMimeForExt(ext),
    truncated,
  }
}
