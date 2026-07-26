/**
 * Open a path / containing folder via OS defaults.
 *
 * Spike notes (PR-4):
 * - API: `@tauri-apps/plugin-opener` `openPath` (primary); `openUrl(file://…)` then
 *   `@tauri-apps/plugin-shell` `open` as fallbacks.
 * - Capabilities: `opener:allow-open-path` (incl. `$HOME/.hip/**`) + `opener:allow-open-url`
 *   (http(s)/mailto/tel/file) + `shell:allow-open` / `opener:default`.
 * - Behavior: opens a **folder window** (file → parent dir; dir → itself). This is **not**
 *   select-in-explorer “Reveal in Finder” (`revealItemInDir` exists but product ships honest
 *   “Open containing folder” labels until platform-specific reveal copy is adopted).
 * - Failure: sonner toast; returns false; never throws to the UI.
 * - Trust: only paths under session/draft `cwd` after normalize + separator-aware prefix check.
 *
 * Note: Unix opener defaults `require_literal_leading_dot=true`, so `$HOME/**` alone does
 * **not** match `~/.hip/...`. We set `requireLiteralLeadingDot: false` in tauri.conf and
 * also allow `$HOME/.hip/**` explicitly for Chat scratch deliverables.
 */
import { openPath as openerOpenPath, openUrl as openerOpenUrl } from '@tauri-apps/plugin-opener'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { toast } from 'sonner'
import i18n from '@/i18n'
import {
  containingFolderOf,
  isPathUnderRoot,
  normalizeFsPath,
} from '@/lib/pathBoundary'

/** Build a file:// URL suitable for opener/openUrl (encode path segments). */
export function pathToFileUrl(absPath: string): string {
  const n = normalizeFsPath(absPath)
  if (!n) return ''
  // Windows drive: c:/foo → file:///c:/foo
  if (/^[a-zA-Z]:\//.test(n)) {
    const parts = n.split('/')
    const encoded = parts.map((p, i) => (i === 0 ? p : encodeURIComponent(p))).join('/')
    return `file:///${encoded}`
  }
  const encoded = n
    .split('/')
    .map((p, i) => (i === 0 ? p : encodeURIComponent(p)))
    .join('/')
  return encoded.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`
}

async function tryOpenFilesystemTarget(target: string): Promise<void> {
  try {
    await openerOpenPath(target)
    return
  } catch (err) {
    // Path scope / hidden-dir mismatches: try file:// then shell.
    try {
      const fileUrl = pathToFileUrl(target)
      if (fileUrl) {
        await openerOpenUrl(fileUrl)
        return
      }
    } catch {
      /* fall through */
    }
    try {
      await shellOpen(target)
      return
    } catch (err2) {
      // Prefer the original opener error in logs; shell rarely allows bare file paths.
      console.error('[openFilesystemTarget] failed', { path: target, err, err2 })
      throw err2
    }
  }
}

export type OpenContainingFolderOptions = {
  /** Session / draft workspace root. Required for trust boundary. */
  cwd: string | null
  /** When true, open `path` itself; when false, open its parent. */
  isDir: boolean
}

/**
 * Open the containing folder for `path` in the system file manager.
 * Returns whether the OS open call was attempted successfully.
 */
export async function openContainingFolder(
  path: string,
  options: OpenContainingFolderOptions,
): Promise<boolean> {
  const { cwd, isDir } = options
  if (!cwd || !path) {
    toast.error(i18n.t('contextMenu.file.pathOutsideCwd'))
    return false
  }
  if (!isPathUnderRoot(path, cwd)) {
    toast.error(i18n.t('contextMenu.file.pathOutsideCwd'))
    return false
  }

  const folder = containingFolderOf(path, isDir)
  // Parent of a path under cwd is still under or equal to cwd for normal trees;
  // re-check so we never open outside (e.g. odd roots / drive edges).
  if (!folder || !isPathUnderRoot(folder, cwd)) {
    toast.error(i18n.t('contextMenu.file.pathOutsideCwd'))
    return false
  }

  const target = normalizeFsPath(folder)
  try {
    await tryOpenFilesystemTarget(target)
    return true
  } catch {
    toast.error(i18n.t('contextMenu.file.openContainingFolderFailed'))
    return false
  }
}

/**
 * Open a file (or dir) with the OS default application (e.g. HTML → default browser).
 * Same cwd trust boundary as openContainingFolder. Returns whether open was attempted successfully.
 *
 * Requires `opener:allow-open-path` **with path scopes** in capabilities
 * (command-only permission rejects every path as ForbiddenPath). Chat scratch under
 * `~/.hip/` needs an explicit scope or `requireLiteralLeadingDot: false`.
 */
export async function openWithDefaultApp(
  path: string,
  options: { cwd: string | null },
): Promise<boolean> {
  const { cwd } = options
  if (!cwd || !path) {
    toast.error(i18n.t('contextMenu.file.pathOutsideCwd'))
    return false
  }
  if (!isPathUnderRoot(path, cwd)) {
    toast.error(i18n.t('contextMenu.file.pathOutsideCwd'))
    return false
  }

  const target = normalizeFsPath(path)
  try {
    await tryOpenFilesystemTarget(target)
    return true
  } catch (err) {
    console.error('[openWithDefaultApp] failed', { path: target, err })
    toast.error(i18n.t('contextMenu.file.openWithDefaultAppFailed'))
    return false
  }
}
