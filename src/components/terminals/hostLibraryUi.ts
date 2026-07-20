import { create } from 'zustand'

/**
 * Lightweight UI signals for HostLibrary (create-host from sidebar, etc.).
 * Catalog data stays in terminalHostStore.
 *
 * `pendingCreateHost` is a one-shot flag: request sets true, HostLibrary
 * consumes it when opening the form so remounts do not re-open a stale request.
 *
 * `quickConnectOpenTick` bumps when the command palette asks to open 快捷连接;
 * the sidebar 新建终端 popover opens on tick change (after enterTerminalsSection).
 */
interface HostLibraryUiState {
  pendingCreateHost: boolean
  requestCreateHost: () => void
  /** Clear the one-shot; returns whether a request was pending. */
  consumeCreateHostRequest: () => boolean

  /** Monotonic tick — sidebar 新建终端 popover watches and opens. */
  quickConnectOpenTick: number
  requestOpenQuickConnect: () => void
}

export const useHostLibraryUi = create<HostLibraryUiState>((set, get) => ({
  pendingCreateHost: false,
  requestCreateHost: () => set({ pendingCreateHost: true }),
  consumeCreateHostRequest: () => {
    if (!get().pendingCreateHost) return false
    set({ pendingCreateHost: false })
    return true
  },

  quickConnectOpenTick: 0,
  requestOpenQuickConnect: () =>
    set((s) => ({ quickConnectOpenTick: s.quickConnectOpenTick + 1 })),
}))
