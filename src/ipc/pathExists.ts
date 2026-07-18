import { invoke } from '@tauri-apps/api/core'

/**
 * Whether `path` exists and is a directory.
 * Returns `null` when the check cannot run (non-Tauri / IPC failure) so UI
 * does not flash a false "missing" state.
 */
export async function isDirectory(path: string): Promise<boolean | null> {
  const p = path.trim()
  if (!p) return false
  try {
    return await invoke<boolean>('path_is_dir', { path: p })
  } catch (e) {
    console.error('[hip] path_is_dir failed:', e)
    return null
  }
}
