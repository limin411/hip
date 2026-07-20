import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { homeDir } from '@tauri-apps/api/path'
import { ptyKill } from '@/ipc/pty'
import { interactiveTerminalList, sshClose } from '@/ipc/ssh'
import { sftpCancel } from '@/ipc/sftp'
import type { TerminalHost } from '@/ipc/terminalHosts'
import { useTerminalStore } from '@/store/terminalStore'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import { useTerminalFsStore } from '@/store/terminalFsStore'

/** Cancel in-flight SFTP transfers for a terminal before tearing down SSH (Issue 8). */
async function cancelSftpTransfers(terminalId: string): Promise<void> {
  const ops = useTerminalFsStore
    .getState()
    .transfers.filter((t) => t.terminalId === terminalId)
  await Promise.all(
    ops.map((t) =>
      sftpCancel(terminalId, t.opId).catch(() => {
        /* already finished */
      }),
    ),
  )
  // Also clear any ops Rust still tracks (empty opId = all for terminal).
  try {
    await sftpCancel(terminalId, '')
  } catch {
    /* ignore */
  }
}

/** Stable English substring matched by XtermSurface / HostLibrary soft-cap UX. */
const SOFT_CAP_ERROR =
  'Too many terminals open (max 8). Close a session first.'

/** Pre-check via Rust interactive list (UX only; Rust remains authoritative on open). */
async function assertSoftCapRoom(): Promise<void> {
  try {
    const list = await interactiveTerminalList()
    if (list.length >= 8) {
      throw new Error(SOFT_CAP_ERROR)
    }
  } catch (e) {
    // Re-throw soft-cap; ignore non-Tauri / list failures so open can still try Rust path.
    if (e instanceof Error && e.message.includes('Too many terminals')) throw e
  }
}

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
   * Register an SSH managed terminal and focus it.
   * Actual `ssh_open` happens in ManagedTerminalSession / XtermSurface; pushRecent after success.
   */
  openSsh: (host: TerminalHost) => Promise<string>

  /**
   * Kill backend (local pty / SSH), clear ring, remove from list.
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

/** After a successful `ssh_open`, record a recent SSH launch (K11). */
export async function recordSuccessfulSshLaunch(hostId: string, label: string): Promise<void> {
  await useTerminalHostStore.getState().pushRecent({
    type: 'ssh',
    hostId,
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
    await assertSoftCapRoom()
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

  openSsh: async (host) => {
    // Soft-cap surfaces at Connect (before minting a tab); Rust still enforces on ssh_open.
    await assertSoftCapRoom()
    const id = mintManagedTerminalId()
    const entry: ManagedTerminal = {
      id,
      kind: 'ssh',
      title: host.label?.trim() || `${host.username}@${host.hostname}`,
      hostId: host.id,
      remotePath: host.remotePath,
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
      try {
        await sshClose(id)
      } catch {
        /* already dead */
      }
      useTerminalStore.getState().clearSession(id)
      useTerminalFsStore.getState().clearTerminal(id)
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
    } else if (term.kind === 'ssh') {
      await cancelSftpTransfers(id)
      try {
        await sshClose(id)
      } catch {
        /* ok if already dead */
      }
    }

    useTerminalStore.getState().clearSession(id)
    useTerminalFsStore.getState().clearTerminal(id)
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
