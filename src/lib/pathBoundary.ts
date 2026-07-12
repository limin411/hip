/**
 * Path boundary helpers for cwd-scoped FS UI actions (open folder, relative paths).
 * Pure string logic — no real FS / symlink resolution (renderer has none).
 *
 * Trust rule: after normalize, a path is under root iff equal to root OR
 * starts with root + separator (never bare startsWith alone — avoids `/project` vs `/project-evil`).
 */

/** Normalize separators to `/`, collapse `.` / `..`, strip trailing slash (except roots). */
export function normalizeFsPath(input: string): string {
  if (!input) return ''
  const raw = input.replace(/\\/g, '/')

  const drive = raw.match(/^([a-zA-Z]:)(\/.*)?$/)
  const isUnc = raw.startsWith('//') && !drive
  const isAbsUnix = raw.startsWith('/') && !isUnc

  let prefix = ''
  let body = raw
  if (drive) {
    prefix = drive[1]!.toLowerCase()
    body = drive[2] ?? '/'
    if (!body.startsWith('/')) body = `/${body}`
  } else if (isUnc) {
    const m = raw.match(/^\/\/[^/]+/)
    prefix = m?.[0] ?? '//'
    body = raw.slice(prefix.length)
  } else if (isAbsUnix) {
    body = raw
  }

  const isAbs = Boolean(drive || isUnc || isAbsUnix)
  const parts = body.split('/').filter((s) => s.length > 0 && s !== '.')
  const stack: string[] = []
  for (const part of parts) {
    if (part === '..') {
      if (stack.length > 0) stack.pop()
      else if (!isAbs) stack.push('..')
    } else {
      stack.push(part)
    }
  }

  if (drive) {
    return stack.length === 0 ? `${prefix}/` : `${prefix}/${stack.join('/')}`
  }
  if (isUnc) {
    return stack.length === 0 ? prefix : `${prefix}/${stack.join('/')}`
  }
  if (isAbsUnix) {
    return `/${stack.join('/')}`
  }
  return stack.join('/')
}

function compareKey(p: string): string {
  // Windows drive paths are case-insensitive
  if (/^[a-zA-Z]:/.test(p)) return p.toLowerCase()
  return p
}

/** True when `target` is `root` or a descendant (separator-aware). */
export function isPathUnderRoot(target: string, root: string): boolean {
  if (!target || !root) return false
  const t = compareKey(normalizeFsPath(target))
  const r = compareKey(normalizeFsPath(root))
  if (!t || !r) return false
  if (t === r) return true
  const prefix = r.endsWith('/') ? r : `${r}/`
  return t.startsWith(prefix)
}

/** Path relative to root, or null if outside / unresolvable. Root itself → `.`. */
export function relativeToRoot(target: string, root: string): string | null {
  if (!isPathUnderRoot(target, root)) return null
  const t = normalizeFsPath(target)
  const r = normalizeFsPath(root)
  if (compareKey(t) === compareKey(r)) return '.'
  const rCmp = compareKey(r)
  const tCmp = compareKey(t)
  const prefix = rCmp.endsWith('/') ? rCmp : `${rCmp}/`
  if (!tCmp.startsWith(prefix)) return null
  // Slice using original normalized `t` length of prefix (same structure)
  const stripLen = (r.endsWith('/') ? r : `${r}/`).length
  return t.slice(stripLen) || '.'
}

/** Parent directory of a path. Drive / unix roots return themselves. */
export function parentDir(path: string): string {
  const n = normalizeFsPath(path)
  if (!n) return ''
  if (n === '/') return '/'
  if (/^[a-zA-Z]:\/$/.test(n)) return n
  if (/^[a-zA-Z]:$/.test(n)) return `${n}/`
  // UNC host only
  if (/^\/\/[^/]+$/.test(n)) return n

  const idx = n.lastIndexOf('/')
  if (idx < 0) return '.'
  if (idx === 0) return '/'
  // `c:/foo` → `c:/` when parent is drive root
  const head = n.slice(0, idx)
  if (/^[a-zA-Z]:$/.test(head)) return `${head}/`
  return head
}

/**
 * Folder to open for “open containing folder”:
 * - directory → itself
 * - file → parent directory
 */
export function containingFolderOf(path: string, isDir: boolean): string {
  const n = normalizeFsPath(path)
  return isDir ? n : parentDir(n)
}
