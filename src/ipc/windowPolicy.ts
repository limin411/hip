import { invoke } from '@tauri-apps/api/core'
import type { WindowCloseAction } from '@hip/protocol'
import { isWindowCloseAction } from '@hip/protocol'

export interface WindowPolicyDto {
  closeAction: string
  trayEnabled: boolean
  trayAvailable: boolean
  shouldHideOnClose: boolean
}

/** Phase 1 settings options (ask is config-only until Phase 2). */
export const CLOSE_ACTION_OPTIONS = ['hide', 'quit'] as const satisfies readonly WindowCloseAction[]

export function resolveCloseAction(raw: string | undefined): 'hide' | 'quit' {
  if (raw === 'hide') return 'hide'
  return 'quit'
}

export function resolveTrayEnabled(raw: boolean | undefined): boolean {
  return raw === true
}

export async function getWindowPolicy(): Promise<WindowPolicyDto | null> {
  try {
    return await invoke<WindowPolicyDto>('window_get_policy')
  } catch {
    return null
  }
}

export async function setWindowPolicy(
  closeAction: string,
  trayEnabled: boolean,
): Promise<WindowPolicyDto | null> {
  const action = isWindowCloseAction(closeAction) ? closeAction : 'quit'
  try {
    return await invoke<WindowPolicyDto>('window_set_policy', {
      args: { closeAction: action, trayEnabled },
    })
  } catch {
    return null
  }
}

export async function showMainWindow(): Promise<void> {
  try {
    await invoke('window_show_main')
  } catch {
    /* ignore in web / tests */
  }
}
