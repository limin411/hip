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

export interface TerminalHostsCatalog {
  version: number
  groups: HostGroup[]
  hosts: TerminalHost[]
  recents: RecentLaunch[]
}

export const EMPTY_TERMINAL_HOSTS_CATALOG: TerminalHostsCatalog = {
  version: 1,
  groups: [],
  hosts: [],
  recents: [],
}

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
  if (!raw || typeof raw !== 'object') return { ...EMPTY_TERMINAL_HOSTS_CATALOG }
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
  return {
    version: typeof c.version === 'number' && c.version > 0 ? c.version : 1,
    groups,
    hosts,
    recents,
  }
}

/**
 * Load the terminal host catalog from `~/.hip/config/terminal-hosts.json`.
 * Missing / corrupt / IPC error → empty catalog.
 */
export async function listTerminalHosts(): Promise<TerminalHostsCatalog> {
  try {
    const raw = await invoke<unknown>('terminal_hosts_list')
    return normalizeCatalog(raw)
  } catch {
    return { ...EMPTY_TERMINAL_HOSTS_CATALOG }
  }
}

/** Persist the full catalog (atomic 0o600 write on the Rust side). */
export async function saveTerminalHosts(catalog: TerminalHostsCatalog): Promise<void> {
  await invoke<void>('terminal_hosts_save', { catalog })
}
