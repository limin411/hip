// src/ipc/terminalHosts.ts
import { invoke } from '@tauri-apps/api/core'

/** Flat host group (no nesting). */
export interface HostGroup {
  id: string
  name: string
  sort: number
}

export type HostAuthMethod = 'password' | 'privateKey'

/** Saved SSH host metadata (credentials live in auth.json raw keys). */
export interface TerminalHost {
  id: string
  label: string
  groupId?: string
  hostname: string
  port: number
  username: string
  authMethod: HostAuthMethod
  privateKeyPath?: string
  remotePath?: string
  updatedAt: number
}

/** Recent successful launch (K11). */
export type RecentLaunch =
  | { type: 'local'; cwd: string; label?: string; at: number }
  | { type: 'ssh'; hostId: string; label: string; at: number }

/** Persisted managed-terminal record (P2; live status stays in memory). */
export interface TerminalRecord {
  id: string
  hostId: string
  title: string
  remotePath?: string
  status: 'disconnected'
  createdAt: number
}

export interface TerminalHostsCatalog {
  version: number
  groups: HostGroup[]
  hosts: TerminalHost[]
  recents: RecentLaunch[]
  terminalRecords: TerminalRecord[]
}

/** Fresh empty catalog (new arrays every call — safe to mutate). */
export function emptyTerminalHostsCatalog(): TerminalHostsCatalog {
  return { version: 1, groups: [], hosts: [], recents: [], terminalRecords: [] }
}

/**
 * Frozen empty catalog for value comparisons / defaults.
 * Nested arrays are frozen so accidental in-place mutation throws in dev.
 */
export const EMPTY_TERMINAL_HOSTS_CATALOG: TerminalHostsCatalog = Object.freeze({
  version: 1,
  groups: Object.freeze([]) as unknown as HostGroup[],
  hosts: Object.freeze([]) as unknown as TerminalHost[],
  recents: Object.freeze([]) as unknown as RecentLaunch[],
  terminalRecords: Object.freeze([]) as unknown as TerminalRecord[],
})

function isAuthMethod(v: unknown): v is HostAuthMethod {
  return v === 'password' || v === 'privateKey'
}

function normalizeRecent(raw: unknown): RecentLaunch | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.type === 'local' && typeof r.cwd === 'string' && typeof r.at === 'number') {
    return {
      type: 'local',
      cwd: r.cwd,
      label: typeof r.label === 'string' ? r.label : undefined,
      at: r.at,
    }
  }
  if (
    r.type === 'ssh' &&
    typeof r.hostId === 'string' &&
    typeof r.label === 'string' &&
    typeof r.at === 'number'
  ) {
    return { type: 'ssh', hostId: r.hostId, label: r.label, at: r.at }
  }
  return null
}

function normalizeTerminalRecord(raw: unknown): TerminalRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (
    typeof r.id !== 'string' ||
    typeof r.hostId !== 'string' ||
    typeof r.title !== 'string' ||
    typeof r.createdAt !== 'number'
  ) {
    return null
  }
  return {
    id: r.id,
    hostId: r.hostId,
    title: r.title,
    remotePath: typeof r.remotePath === 'string' ? r.remotePath : undefined,
    status: 'disconnected',
    createdAt: r.createdAt,
  }
}

function normalizeHost(raw: unknown): TerminalHost | null {
  if (!raw || typeof raw !== 'object') return null
  const h = raw as Record<string, unknown>
  if (
    typeof h.id !== 'string' ||
    typeof h.label !== 'string' ||
    typeof h.hostname !== 'string' ||
    typeof h.port !== 'number' ||
    typeof h.username !== 'string' ||
    !isAuthMethod(h.authMethod) ||
    typeof h.updatedAt !== 'number'
  ) {
    return null
  }
  return {
    id: h.id,
    label: h.label,
    groupId: typeof h.groupId === 'string' ? h.groupId : undefined,
    hostname: h.hostname,
    port: h.port,
    username: h.username,
    authMethod: h.authMethod,
    privateKeyPath: typeof h.privateKeyPath === 'string' ? h.privateKeyPath : undefined,
    remotePath: typeof h.remotePath === 'string' ? h.remotePath : undefined,
    updatedAt: h.updatedAt,
  }
}

function normalizeGroup(raw: unknown): HostGroup | null {
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Record<string, unknown>
  if (typeof g.id !== 'string' || typeof g.name !== 'string' || typeof g.sort !== 'number') {
    return null
  }
  return { id: g.id, name: g.name, sort: g.sort }
}

/** Coerce IPC payload into a safe catalog (drops malformed rows). */
export function normalizeCatalog(raw: unknown): TerminalHostsCatalog {
  if (!raw || typeof raw !== 'object') return emptyTerminalHostsCatalog()
  const c = raw as Record<string, unknown>
  const groups = Array.isArray(c.groups)
    ? c.groups.map(normalizeGroup).filter((g): g is HostGroup => g != null)
    : []
  const hosts = Array.isArray(c.hosts)
    ? c.hosts.map(normalizeHost).filter((h): h is TerminalHost => h != null)
    : []
  const recents = Array.isArray(c.recents)
    ? c.recents.map(normalizeRecent).filter((r): r is RecentLaunch => r != null)
    : []
  const terminalRecords = Array.isArray(c.terminalRecords)
    ? c.terminalRecords
        .map(normalizeTerminalRecord)
        .filter((r): r is TerminalRecord => r != null)
    : []
  return {
    version: typeof c.version === 'number' && c.version > 0 ? c.version : 1,
    groups,
    hosts,
    recents,
    terminalRecords,
  }
}

/**
 * Load the terminal host catalog from `~/.hip/config/terminal-hosts.json`.
 * Missing/corrupt file is handled in Rust as an empty catalog (does not reject).
 * IPC failures **propagate** so the store can surface `error`.
 */
export async function listTerminalHosts(): Promise<TerminalHostsCatalog> {
  const raw = await invoke<unknown>('terminal_hosts_list')
  return normalizeCatalog(raw)
}

/** Persist the full catalog (atomic 0o600 write on the Rust side). */
export async function saveTerminalHosts(catalog: TerminalHostsCatalog): Promise<void> {
  await invoke<void>('terminal_hosts_save', { catalog })
}
