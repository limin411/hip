import { create } from 'zustand'

/**
 * Lightweight UI signals for HostLibrary (create-host from sidebar, etc.).
 * Catalog data stays in terminalHostStore.
 */
interface HostLibraryUiState {
  /** Bumped to request opening the create-host form. */
  createRequestId: number
  requestCreateHost: () => void
}

export const useHostLibraryUi = create<HostLibraryUiState>((set) => ({
  createRequestId: 0,
  requestCreateHost: () => set((s) => ({ createRequestId: s.createRequestId + 1 })),
}))
