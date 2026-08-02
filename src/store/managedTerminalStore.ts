import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { homeDir } from '@tauri-apps/api/path'
import { ptyKill } from '@/ipc/pty'
import { interactiveTerminalList, sshClose } from '@/ipc/ssh'
import { sftpCancel } from '@/ipc/sftp'
import type { TerminalHost, TerminalRecord } from '@/ipc/terminalHosts'
import { useTerminalStore } from '@/store/terminalStore'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import { useTerminalFsStore } from '@/store/terminalFsStore'
import { useTerminalAgentStore } from '@/store/terminalAgentStore'

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
export type ManagedTerminalStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

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
  /** Connection status (D12: records survive close; status marks disconnect). */
  status: ManagedTerminalStatus
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

  setStatus: (id: string, status: ManagedTerminalStatus) => void
  /** Remove a record entirely (explicit record delete / Host cascade). */
  removeRecord: (id: string) => void
  /** Restore persisted disconnected records after startup (P2). */
  restorePersisted: (records: TerminalRecord[]) => void
  /** Reopen a closed SSH terminal reusing the same `tm_*` record (new generation). */
  reconnect: (id: string) => Promise<void>
  /** Bumped on reconnect so ManagedTerminalSession remounts XtermSurface. */
  reconnectNonce: Record<string, number>
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
      status: 'connecting',
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
      status: 'connecting',
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
      // Local close keeps current behavior: kill backend + remove record.
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
    useTerminalAgentStore.getState().setExecFlight(id, null)
    useTerminalAgentStore.getState().setActiveSession(id, null)
    set((s) => {
      if (term.kind === 'ssh') {
        // D12: keep the record + child sessions (read-only); mark disconnected.
        persistSshRecord({ ...term, status: 'disconnected' })
        return {
          terminals: s.terminals.map((t) =>
            t.id === id ? { ...t, status: 'disconnected' as const } : t,
          ),
        }
      }
      const terminals = s.terminals.filter((t) => t.id !== id)
      let focusedId = s.focusedId
      if (s.focusedId === id) {
        const idx = s.terminals.findIndex((t) => t.id === id)
        const neighbor = terminals[Math.max(0, idx - 1)] ?? terminals[0] ?? null
        focusedId = neighbor?.id ?? null
      }
      return { terminals, focusedId }
    })
  },

  setTitle: (id, title) => {
    const next = title.trim()
    if (!next) return
    set((s) => {
      const terminals = s.terminals.map((t) => (t.id === id ? { ...t, title: next } : t))
      const term = terminals.find((t) => t.id === id)
      if (term?.kind === 'ssh') persistSshRecord(term)
      return { terminals }
    })
  },

  reconnectNonce: {},

  restorePersisted: (records) => {
    if (!records?.length) return
    const existing = new Set(get().terminals.map((t) => t.id))
    const additions = records
      .filter((r) => !existing.has(r.id))
      .map((r) => ({
        id: r.id,
        kind: 'ssh' as const,
        title: r.title,
        hostId: r.hostId,
        remotePath: r.remotePath,
        status: 'disconnected' as const,
        createdAt: r.createdAt,
      }))
    if (additions.length === 0) return
    set((s) => ({ terminals: [...s.terminals, ...additions] }))
  },

  setStatus: (id, status) =>
    set((s) => {
      const terminals = s.terminals.map((t) => (t.id === id ? { ...t, status } : t))
      const term = terminals.find((t) => t.id === id)
      if (term?.kind === 'ssh') persistSshRecord(term)
      return { terminals }
    }),

  removeRecord: (id) =>
    set((s) => {
      const terminals = s.terminals.filter((t) => t.id !== id)
      useTerminalStore.getState().clearSession(id)
      useTerminalFsStore.getState().clearTerminal(id)
    useTerminalAgentStore.getState().setExecFlight(id, null)
    useTerminalAgentStore.getState().setActiveSession(id, null)
    void useTerminalHostStore.getState().removeTerminalRecord?.(id).catch(() => {})
    let focusedId = s.focusedId
      if (s.focusedId === id) {
        focusedId = terminals[0]?.id ?? null
      }
      return { terminals, focusedId }
    }),

  reconnect: async (id) => {
    const term = get().getTerminal(id)
    if (!term || term.kind !== 'ssh') return
    try {
      await sshClose(id)
    } catch {
      /* already dead */
    }
    useTerminalStore.getState().clearSession(id)
    useTerminalStore.getState().ensureSession(id)
    useTerminalFsStore.getState().clearTerminal(id)
    useTerminalAgentStore.getState().setExecFlight(id, null)
    get().setStatus(id, 'connecting')
    set((s) => ({
      reconnectNonce: {
        ...s.reconnectNonce,
        [id]: (s.reconnectNonce[id] ?? 0) + 1,
      },
    }))
  },
}))

/** Persist an SSH record to the host catalog (live status is never persisted). */
function persistSshRecord(term: ManagedTerminal): void {
  if (term.kind !== 'ssh' || !term.hostId) return
  void useTerminalHostStore
    .getState()
    .upsertTerminalRecord?.({
      id: term.id,
      hostId: term.hostId,
      title: term.title,
      remotePath: term.remotePath,
      status: 'disconnected',
      createdAt: term.createdAt,
    })
    .catch(() => {
      /* catalog write failures must not break terminal runtime */
    })
}
