/**
 * Cwd-scoped path helpers for context menus (diff / file surfaces).
 * Diff paths are workspace-relative; FS tree paths are absolute under cwd.
 */

function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

/** Collapse `.` / `..` segments without resolving symlinks (browser-safe). */
export function collapsePath(p: string): string {
  const raw = toPosix(p)
  const isAbs = raw.startsWith('/')
  const winDrive = raw.match(/^([A-Za-z]:)(\/.*)?$/)
  let prefix = ''
  let body = raw
  if (winDrive) {
    prefix = winDrive[1]!
    body = winDrive[2] ?? '/'
  } else if (isAbs) {
    prefix = ''
  }
  const parts = body.split('/').filter((s) => s.length > 0 && s !== '.')
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!prefix && !isAbs) out.push('..')
    } else {
      out.push(part)
    }
  }
  if (winDrive) return `${prefix}/${out.join('/')}`.replace(/\/+$/, '') || `${prefix}/`
  if (isAbs) return `/${out.join('/')}` || '/'
  return out.join('/') || '.'
}

function isUnderRoot(root: string, target: string): boolean {
  const r = collapsePath(root).replace(/\/+$/, '')
  const t = collapsePath(target)
  if (t === r) return true
  const rLower = r.toLowerCase()
  const tLower = t.toLowerCase()
  // Case-insensitive prefix for Windows drive paths; posix stays exact.
  if (/^[a-z]:/i.test(r)) {
    return tLower === rLower || tLower.startsWith(`${rLower}/`)
  }
  return t === r || t.startsWith(`${r}/`)
}

/**
 * Resolve `filePath` (relative or absolute) under `cwd`.
 * Returns absolute path on success, or null if cwd missing / path escapes cwd.
 */
export function resolvePathUnderCwd(cwd: string | null | undefined, filePath: string): string | null {
  if (!cwd?.trim() || !filePath) return null
  const root = collapsePath(cwd.trim()).replace(/\/+$/, '')
  const fp = toPosix(filePath.trim())
  if (!fp) return null
  const isAbs = fp.startsWith('/') || /^[A-Za-z]:\//.test(fp) || /^[A-Za-z]:$/.test(fp)
  const abs = isAbs ? collapsePath(fp) : collapsePath(`${root}/${fp.replace(/^\/+/, '')}`)
  if (!isUnderRoot(root, abs)) return null
  return abs
}

/** Relative path under cwd for display/copy; null if not under cwd. */
export function relativePathUnderCwd(cwd: string | null | undefined, absOrRel: string): string | null {
  if (!cwd?.trim() || !absOrRel) return null
  const root = collapsePath(cwd.trim()).replace(/\/+$/, '')
  const abs = resolvePathUnderCwd(cwd, absOrRel)
  if (!abs) return null
  if (abs === root) return '.'
  const prefix = `${root}/`
  if (abs.startsWith(prefix)) return abs.slice(prefix.length)
  // Windows case-insensitive
  if (abs.toLowerCase().startsWith(prefix.toLowerCase())) return abs.slice(prefix.length)
  return null
}
