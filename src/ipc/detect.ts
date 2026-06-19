import { invoke } from '@tauri-apps/api/core'

/** Probe PATH for each executable name. Fail-closed: on error treat all as not-found
 *  so a detection failure never makes an unrunnable agent look addable. */
export async function detectBinaries(names: string[]): Promise<Record<string, boolean>> {
  try {
    return await invoke<Record<string, boolean>>('which_binaries', { names })
  } catch {
    return {}
  }
}
