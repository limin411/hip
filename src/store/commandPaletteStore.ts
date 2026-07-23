import { create } from 'zustand'
import type { PalettePageId } from '@/components/command-palette/types'

export type { PalettePageId }

interface CommandPaletteState {
  open: boolean
  page: PalettePageId | null
  /** Root search restored when leaving a nested page. */
  previousSearch: string
  setOpen: (open: boolean) => void
  toggle: () => void
  openPage: (page: PalettePageId, rootSearch?: string) => void
  setPage: (page: PalettePageId | null) => void
  /** Pop nested page; returns restored root search (or ''). */
  goBack: () => string
  close: () => void
}

const cleared = { open: false, page: null as PalettePageId | null, previousSearch: '' }

export const useCommandPaletteStore = create<CommandPaletteState>((set, get) => ({
  open: false,
  page: null,
  previousSearch: '',
  setOpen: (open) => set(open ? { open: true } : { ...cleared }),
  toggle: () =>
    set((s) => (s.open ? { ...cleared } : { open: true, page: null, previousSearch: '' })),
  openPage: (page, rootSearch = '') =>
    set({ open: true, page, previousSearch: rootSearch }),
  setPage: (page) => set({ page, ...(page === null ? { previousSearch: '' } : {}) }),
  goBack: () => {
    const prev = get().previousSearch
    set({ page: null, previousSearch: '' })
    return prev
  },
  close: () => set({ ...cleared }),
}))
