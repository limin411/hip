/**
 * Open a path / containing folder via OS defaults.
 *
 * Spike notes (PR-4):
 * - API: `@tauri-apps/plugin-opener` `openPath` (primary); fallback `@tauri-apps/plugin-shell` `open`.
 * - Capabilities: `opener:allow-open-path` + existing `shell:allow-open` / `opener:default`.
 * - Behavior: opens a **folder window** (file → parent dir; dir → itself). This is **not**
 *   select-in-explorer “Reveal in Finder” (`revealItemInDir` exists but product ships honest
 *   “Open containing folder” labels until platform-specific reveal copy is adopted).
 * - Failure: sonner toast; returns false; never throws to the UI.
 * - Trust: only paths under session/draft `cwd` after normalize + separator-aware prefix check.
 */
import { openPath as openerOpenPath } from '@tauri-apps/plugin-opener'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { toast } from 'sonner'
import i18n from '@/i18n'
import {
  containingFolderOf,
  isPathUnderRoot,
  normalizeFsPath,
} from '@/lib/pathBoundary'

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
    await openerOpenPath(target)
    return true
  } catch {
    try {
      await shellOpen(target)
      return true
    } catch {
      toast.error(i18n.t('contextMenu.file.openContainingFolderFailed'))
      return false
    }
  }
}

/** Open an arbitrary path with the default app (still cwd-scoped). */
export async function openPathInDefaultApp(
  path: string,
  cwd: string | null,
): Promise<boolean> {
  if (!cwd || !path || !isPathUnderRoot(path, cwd)) {
    toast.error(i18n.t('contextMenu.file.pathOutsideCwd'))
    return false
  }
  const target = normalizeFsPath(path)
  try {
    await openerOpenPath(target)
    return true
  } catch {
    try {
      await shellOpen(target)
      return true
    } catch {
      toast.error(i18n.t('contextMenu.file.openContainingFolderFailed'))
      return false
    }
  }
}
