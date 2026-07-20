import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { homeDir } from '@tauri-apps/api/path'
import { ptyKill } from '@/ipc/pty'
import { useTerminalStore } from '@/store/terminalStore'
import { useTerminalHostStore } from '@/store/terminalHostStore'

export type ManagedTerminalKind = 'local' | 'ssh'

export interface ManagedTerminal {
  /** Always `tm_<nanoid>` (K1). */
  id: string
  kind: ManagedTerminalKind
  title: string
  /** SSH host catalog id (ssh only). */
  hostId?: string
  /** Launch cwd / tree root (local). */
  cwd?: string
  remotePath?: string
  createdAt: number
}

export function isManagedTerminalId(id: string): boolean {
  return id.startsWith('tm_')
}

/** Mint a managed terminal id (`tm_` + nanoid). */
export function mintManagedTerminalId(): string {
  return `tm_${nanoid()}`
}

/** Display title from a local launch path (last path segment). */
export function localTerminalTitle(cwd: string, label?: string): string {
  if (label?.trim()) return label.trim()
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || cwd || 'Local'
}

interface ManagedTerminalStore {
  /** Active managed terminals (process-ephemeral). */
  terminals: ManagedTerminal[]
  /** Focused terminal id; null = host-library / empty mode. */
  focusedId: string | null

  focus: (id: string | null) => void
  getTerminal: (id: string) => ManagedTerminal | undefined

  /**
   * Register a local managed terminal and focus it.
   * PTY open happens in ManagedTerminalSession / XtermSurface; pushRecent after success.
   */
  openLocal: (opts?: { cwd?: string; label?: string }) => Promise<string>

  /**
   * Kill backend (local pty), clear ring, remove from list.
   * Does not clear host catalog recents.
   */
  close: (id: string) => Promise<void>

  /** Update title (e.g. after rename / label). */
  setTitle: (id: string, title: string) => void
}

/**
 * After a successful `pty_open` / `ssh_open`, record a recent launch (K11).
 * Call from the session open path — not from form submit alone.
 */
export async function recordSuccessfulLocalLaunch(cwd: string, label?: string): Promise<void> {
  await useTerminalHostStore.getState().pushRecent({
    type: 'local',
    cwd,
    label,
    at: Date.now(),
  })
}

export const useManagedTerminalStore = create<ManagedTerminalStore>((set, get) => ({
  terminals: [],
  focusedId: null,

  focus: (id) => set({ focusedId: id }),

  getTerminal: (id) => get().terminals.find((t) => t.id === id),

  openLocal: async (opts) => {
    let cwd = opts?.cwd?.trim()
    if (!cwd) {
      try {
        cwd = (await homeDir()).replace(/\/+$/, '') || undefined
      } catch {
        cwd = undefined
      }
    }
    if (!cwd) {
      throw new Error('Could not resolve home directory for local terminal')
    }

    const id = mintManagedTerminalId()
    const title = localTerminalTitle(cwd, opts?.label)
    const entry: ManagedTerminal = {
      id,
      kind: 'local',
      title,
      cwd,
      createdAt: Date.now(),
    }

    useTerminalStore.getState().ensureSession(id)
    set((s) => ({
      terminals: [...s.terminals, entry],
      focusedId: id,
    }))
    return id
  },

  close: async (id) => {
    const term = get().getTerminal(id)
    if (!term) {
      // Still try to free native resources if id is known to rings only.
      try {
        await ptyKill(id)
      } catch {
        /* already dead */
      }
      useTerminalStore.getState().clearSession(id)
      set((s) => ({
        focusedId: s.focusedId === id ? null : s.focusedId,
      }))
      return
    }

    if (term.kind === 'local') {
      try {
        await ptyKill(id)
      } catch {
        /* ok if already dead */
      }
    }
    // SSH close lands in PR5.

    useTerminalStore.getState().clearSession(id)
    set((s) => {
      const terminals = s.terminals.filter((t) => t.id !== id)
      let focusedId = s.focusedId
      if (s.focusedId === id) {
        // Prefer nearest neighbor (previous index), else next, else null.
        const idx = s.terminals.findIndex((t) => t.id === id)
        const neighbor =
          terminals[Math.max(0, idx - 1)] ?? terminals[0] ?? null
        focusedId = neighbor?.id ?? null
      }
      return { terminals, focusedId }
    })
  },

  setTitle: (id, title) => {
    const next = title.trim()
    if (!next) return
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === id ? { ...t, title: next } : t)),
    }))
  },
}))
