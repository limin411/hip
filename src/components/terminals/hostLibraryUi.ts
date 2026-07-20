import { create } from 'zustand'

/**
 * Lightweight UI signals for HostLibrary (create-host from sidebar, etc.).
 * Catalog data stays in terminalHostStore.
 *
 * `pendingCreateHost` is a one-shot flag: request sets true, HostLibrary
 * consumes it when opening the form so remounts do not re-open a stale request.
 */
interface HostLibraryUiState {
  pendingCreateHost: boolean
  requestCreateHost: () => void
  /** Clear the one-shot; returns whether a request was pending. */
  consumeCreateHostRequest: () => boolean
}

export const useHostLibraryUi = create<HostLibraryUiState>((set, get) => ({
  pendingCreateHost: false,
  requestCreateHost: () => set({ pendingCreateHost: true }),
  consumeCreateHostRequest: () => {
    if (!get().pendingCreateHost) return false
    set({ pendingCreateHost: false })
    return true
  },
}))
