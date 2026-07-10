import { create } from 'zustand'

interface CommandPaletteState {
  open: boolean
  page: string | null
  setOpen: (open: boolean) => void
  toggle: () => void
  openPage: (page: string) => void
  close: () => void
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  open: false,
  page: null,
  setOpen: (open) => set(open ? { open: true } : { open: false, page: null }),
  toggle: () =>
    set((s) => (s.open ? { open: false, page: null } : { open: true })),
  openPage: (page) => set({ open: true, page }),
  close: () => set({ open: false, page: null }),
}))
