import { create } from 'zustand'
import {
  listTerminalHosts,
  saveTerminalHosts,
  type HostGroup,
  type RecentLaunch,
  type TerminalHost,
  type TerminalHostsCatalog,
} from '@/ipc/terminalHosts'
import { deleteSecretRaw, sshPassphraseKey, sshPasswordKey } from '@/ipc/secrets'

/** Product cap for 快捷连接 (K11). */
export const MAX_RECENTS = 5

/** Dedupe key: local → `local:${cwd}`; ssh → `ssh:${hostId}`. */
export function recentKey(r: RecentLaunch): string {
  return r.type === 'local' ? `local:${r.cwd}` : `ssh:${r.hostId}`
}

/**
 * Insert a successful launch at the front, dedupe by key, cap at MAX_RECENTS.
 * Pure — does not persist.
 */
export function pushRecentEntry(
  recents: readonly RecentLaunch[],
  entry: RecentLaunch,
): RecentLaunch[] {
  const key = recentKey(entry)
  const rest = recents.filter((r) => recentKey(r) !== key)
  return [entry, ...rest].slice(0, MAX_RECENTS)
}

/** Drop SSH recents whose hostId is not in the live host set; keep all local. */
export function filterRecentsForHosts(
  recents: readonly RecentLaunch[],
  hostIds: ReadonlySet<string>,
): RecentLaunch[] {
  return recents.filter((r) => r.type === 'local' || hostIds.has(r.hostId))
}

export function hostIdSet(hosts: readonly TerminalHost[]): Set<string> {
  return new Set(hosts.map((h) => h.id))
}

interface TerminalHostStore {
  groups: HostGroup[]
  hosts: TerminalHost[]
  recents: RecentLaunch[]
  loaded: boolean
  error: string | null

  load: () => Promise<void>
  /** Persist current catalog state (serialized with other saves). */
  save: () => Promise<void>
  /** Replace catalog (e.g. after form compose) and optionally persist. */
  setCatalog: (catalog: TerminalHostsCatalog, opts?: { persist?: boolean }) => Promise<void>

  upsertGroup: (group: HostGroup) => Promise<void>
  removeGroup: (id: string) => Promise<void>
  upsertHost: (host: TerminalHost) => Promise<void>
  /**
   * Remove host row, filter recents, persist catalog, then best-effort delete
   * both SSH secret keys. Session force-close is handled by callers once
   * managed terminals exist (K21).
   */
  removeHost: (id: string) => Promise<void>
  /** Push a successful launch into recents and persist (K11). */
  pushRecent: (entry: RecentLaunch) => Promise<void>
}

function toCatalog(s: {
  groups: HostGroup[]
  hosts: TerminalHost[]
  recents: RecentLaunch[]
}): TerminalHostsCatalog {
  return {
    version: 1,
    groups: s.groups,
    hosts: s.hosts,
    recents: s.recents,
  }
}

/**
 * Serialize catalog IPC writes so concurrent mutations cannot clobber each other.
 * Each `save` snapshots Zustand state when its turn runs (latest wins), not when
 * it was enqueued mid-flight.
 */
let saveChain: Promise<void> = Promise.resolve()

function enqueueSave(run: () => Promise<void>): Promise<void> {
  // Run even if the previous save failed so one disk error does not stall the queue.
  const next = saveChain.then(run, run)
  // Keep the chain alive after rejections.
  saveChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

export const useTerminalHostStore = create<TerminalHostStore>((set, get) => ({
  groups: [],
  hosts: [],
  recents: [],
  loaded: false,
  error: null,

  load: async () => {
    try {
      // listTerminalHosts propagates IPC failures (missing/corrupt file is empty in Rust).
      const catalog = await listTerminalHosts()
      const hostIds = hostIdSet(catalog.hosts)
      const recents = filterRecentsForHosts(catalog.recents, hostIds)
      set({
        groups: catalog.groups,
        hosts: catalog.hosts,
        recents,
        loaded: true,
        error: null,
      })
    } catch (e) {
      set({
        loaded: true,
        error: e instanceof Error ? e.message : 'Failed to load terminal hosts',
      })
    }
  },

  save: () =>
    enqueueSave(async () => {
      try {
        // Snapshot at write time so chained saves always persist latest state.
        await saveTerminalHosts(toCatalog(get()))
        set({ error: null })
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to save terminal hosts'
        set({ error: msg })
        throw e
      }
    }),

  setCatalog: async (catalog, opts) => {
    const hostIds = hostIdSet(catalog.hosts)
    const recents = filterRecentsForHosts(catalog.recents, hostIds)
    set({
      groups: catalog.groups,
      hosts: catalog.hosts,
      recents,
      error: null,
    })
    if (opts?.persist !== false) {
      await get().save()
    }
  },

  upsertGroup: async (group) => {
    set((s) => {
      const idx = s.groups.findIndex((g) => g.id === group.id)
      const groups =
        idx >= 0
          ? s.groups.map((g, i) => (i === idx ? group : g))
          : [...s.groups, group]
      return { groups, error: null }
    })
    await get().save()
  },

  removeGroup: async (id) => {
    set((s) => ({
      groups: s.groups.filter((g) => g.id !== id),
      // Detach hosts from deleted group (keep hosts).
      hosts: s.hosts.map((h) =>
        h.groupId === id ? { ...h, groupId: undefined } : h,
      ),
      error: null,
    }))
    await get().save()
  },

  upsertHost: async (host) => {
    set((s) => {
      const idx = s.hosts.findIndex((h) => h.id === host.id)
      const hosts =
        idx >= 0
          ? s.hosts.map((h, i) => (i === idx ? host : h))
          : [...s.hosts, host]
      return { hosts, error: null }
    })
    await get().save()
  },

  removeHost: async (id) => {
    const prevHosts = get().hosts
    const prevRecents = get().recents
    set((s) => {
      const hosts = s.hosts.filter((h) => h.id !== id)
      const recents = filterRecentsForHosts(s.recents, hostIdSet(hosts))
      return { hosts, recents, error: null }
    })
    // Persist catalog first. Only delete secrets after the host row is gone on disk
    // so a failed save does not leave a credential-less restored host (K21 order:
    // catalog then secrets is safer than secrets-then-catalog for this failure mode).
    try {
      await get().save()
    } catch (e) {
      set({ hosts: prevHosts, recents: prevRecents })
      throw e
    }
    try {
      await deleteSecretRaw(sshPasswordKey(id))
    } catch {
      /* ignore */
    }
    try {
      await deleteSecretRaw(sshPassphraseKey(id))
    } catch {
      /* ignore */
    }
  },

  pushRecent: async (entry) => {
    set((s) => ({
      recents: pushRecentEntry(s.recents, entry),
      error: null,
    }))
    await get().save()
  },
}))
