import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  ImConnectorRecord,
  ImConnectorPublic,
  ImParkedEntry,
} from '@hip/protocol'

// ── On-disk shape ──────────────────────────────────────────────────────

interface ImConnectorsFile {
  version: number
  connectors: ImConnectorRecord[]
}

function defaultConfigPath(): string {
  return (
    process.env.HIP_IM_PATH?.trim() ||
    join(homedir(), '.hip', 'config', 'im-connectors.json')
  )
}

// ── Store ──────────────────────────────────────────────────────────────

export class ImConnectorStore {
  private readonly path: string

  constructor(customPath?: string) {
    this.path = customPath ?? defaultConfigPath()
  }

  private read(): ImConnectorsFile {
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8'))
      if (raw && typeof raw === 'object' && Array.isArray(raw.connectors)) {
        return raw as ImConnectorsFile
      }
      return { version: 1, connectors: [] }
    } catch {
      return { version: 1, connectors: [] }
    }
  }

  private write(data: ImConnectorsFile): void {
    const dir = dirname(this.path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.path, JSON.stringify(data, null, 2), 'utf8')
    try {
      chmodSync(this.path, 0o600)
    } catch {
      /* best-effort on non-POSIX */
    }
  }

  /** List all connectors (credentials stripped). */
  listPublic(): ImConnectorPublic[] {
    return this.read().connectors.map(stripCredentials)
  }

  /** List all connectors (with credentials, internal use). */
  listAll(): ImConnectorRecord[] {
    return this.read().connectors
  }

  /** Get a single connector by id (with credentials). */
  get(id: string): ImConnectorRecord | undefined {
    return this.read().connectors.find((c) => c.id === id)
  }

  /** Get a single connector by id (public, no credentials). */
  getPublic(id: string): ImConnectorPublic | undefined {
    const c = this.get(id)
    return c ? stripCredentials(c) : undefined
  }

  /** Upsert a connector. If id doesn't exist, generates a new uuid. */
  upsert(connector: ImConnectorRecord): ImConnectorPublic {
    const data = this.read()
    const now = Date.now()
    const idx = data.connectors.findIndex((c) => c.id === connector.id)
    if (idx >= 0) {
      // Preserve existing credentials if incoming ones are empty/placeholder
      const existing = data.connectors[idx]
      const merged: ImConnectorRecord = {
        ...connector,
        credentials: hasEmptyCredentials(connector.credentials)
          ? existing.credentials
          : connector.credentials,
        updatedAt: now,
      }
      data.connectors[idx] = merged
    } else {
      const newConnector: ImConnectorRecord = {
        ...connector,
        id: connector.id || randomUUID(),
        createdAt: now,
        updatedAt: now,
      }
      data.connectors.push(newConnector)
    }
    this.write(data)
    const saved = data.connectors.find((c) => c.id === (connector.id || data.connectors[data.connectors.length - 1].id))!
    return stripCredentials(saved)
  }

  /** Remove a connector by id. Returns true if found and removed. */
  remove(id: string): boolean {
    const data = this.read()
    const before = data.connectors.length
    data.connectors = data.connectors.filter((c) => c.id !== id)
    if (data.connectors.length === before) return false
    this.write(data)
    return true
  }

  /** Update status for a connector (in-memory merge + persist). */
  updateStatus(
    id: string,
    status: ImConnectorRecord['status'],
    lastError?: string | null,
  ): void {
    const data = this.read()
    const c = data.connectors.find((x) => x.id === id)
    if (!c) return
    c.status = status
    c.lastError = lastError ?? null
    c.updatedAt = Date.now()
    this.write(data)
  }

  /** Update parked entries for a connector. */
  updateParked(id: string, parked: ImParkedEntry[]): void {
    const data = this.read()
    const c = data.connectors.find((x) => x.id === id)
    if (!c) return
    c.parked = parked
    c.updatedAt = Date.now()
    this.write(data)
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function stripCredentials(c: ImConnectorRecord): ImConnectorPublic {
  const { credentials, ...rest } = c
  return { ...rest, hasCredentials: !hasEmptyCredentials(credentials) }
}

function hasEmptyCredentials(creds: ImConnectorRecord['credentials']): boolean {
  if (!creds) return true
  const vals = Object.values(creds)
  return vals.length === 0 || vals.every((v) => !v || !String(v).trim())
}
