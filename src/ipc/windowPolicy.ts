import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { WindowCloseAction } from '@hip/protocol'
import { isWindowCloseAction } from '@hip/protocol'

export interface WindowPolicyDto {
  closeAction: string
  trayEnabled: boolean
  trayAvailable: boolean
  shouldHideOnClose: boolean
  closePromptSeen: boolean
}

/** Settings options including Phase 2 "ask". */
export const CLOSE_ACTION_OPTIONS = ['hide', 'quit', 'ask'] as const satisfies readonly WindowCloseAction[]

export function resolveCloseAction(raw: string | undefined): WindowCloseAction {
  if (raw === 'hide' || raw === 'ask') return raw
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
  closePromptSeen?: boolean,
): Promise<WindowPolicyDto | null> {
  const action = isWindowCloseAction(closeAction) ? closeAction : 'quit'
  try {
    return await invoke<WindowPolicyDto>('window_set_policy', {
      args: {
        closeAction: action,
        trayEnabled,
        closePromptSeen,
      },
    })
  } catch {
    return null
  }
}

export async function windowCloseDecision(
  action: 'hide' | 'quit',
  remember: boolean,
): Promise<void> {
  try {
    await invoke('window_close_decision', { args: { action, remember } })
  } catch {
    /* ignore in web / tests */
  }
}

export async function showMainWindow(): Promise<void> {
  try {
    await invoke('window_show_main')
  } catch {
    /* ignore */
  }
}

export async function windowForceQuit(): Promise<void> {
  try {
    await invoke('window_force_quit')
  } catch {
    /* ignore */
  }
}

export async function windowCancelExit(): Promise<void> {
  try {
    await invoke('window_cancel_exit')
  } catch {
    /* ignore */
  }
}

export async function windowExitHideInstead(): Promise<void> {
  try {
    await invoke('window_exit_hide_instead')
  } catch {
    /* ignore */
  }
}

export async function traySetStatus(args: {
  runningAgents: number
  runningTasks: number
  label?: string
}): Promise<void> {
  try {
    await invoke('tray_set_status', {
      args: {
        runningAgents: args.runningAgents,
        runningTasks: args.runningTasks,
        label: args.label,
      },
    })
  } catch {
    /* ignore */
  }
}

export function listenClosePrompt(handler: () => void): Promise<UnlistenFn> {
  return listen('window://close-prompt', () => handler())
}

export function listenExitConfirm(handler: () => void): Promise<UnlistenFn> {
  return listen('window://exit-confirm', () => handler())
}

export function listenWindowHidden(handler: () => void): Promise<UnlistenFn> {
  return listen('window://hidden', () => handler())
}
