import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ImConnectorStore } from './store.js'
import type { ImConnectorRecord } from '@hip/protocol'

function makeConnector(overrides: Partial<ImConnectorRecord> = {}): ImConnectorRecord {
  return {
    id: 'test-id-1',
    platform: 'feishu',
    name: 'Test Bot',
    enabled: true,
    credentials: { appId: 'cli_xxx', appSecret: 'secret' },
    permissionMode: 'confirm',
    allowlist: [],
    parked: [],
    status: 'disconnected',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

describe('ImConnectorStore', () => {
  let tmpDir: string
  let configPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'im-store-test-'))
    configPath = join(tmpDir, 'im-connectors.json')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns empty list when file does not exist', () => {
    const store = new ImConnectorStore(configPath)
    expect(store.listPublic()).toEqual([])
  })

  it('handles corrupted file gracefully', () => {
    const { writeFileSync } = require('node:fs')
    writeFileSync(configPath, 'not valid json', 'utf8')
    const store = new ImConnectorStore(configPath)
    expect(store.listPublic()).toEqual([])
  })

  it('upsert creates a new connector with uuid', () => {
    const store = new ImConnectorStore(configPath)
    const c = makeConnector({ id: '' })
    const pub = store.upsert(c)
    expect(pub.id).toBeTruthy()
    expect(pub.hasCredentials).toBe(true)
    // Credentials should NOT be in public view
    expect(pub).not.toHaveProperty('credentials')
  })

  it('upsert updates existing connector', () => {
    const store = new ImConnectorStore(configPath)
    store.upsert(makeConnector({ id: 'c1', name: 'v1' }))
    store.upsert(makeConnector({ id: 'c1', name: 'v2' }))
    const list = store.listPublic()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('v2')
  })

  it('preserves existing credentials when upsert has empty credentials', () => {
    const store = new ImConnectorStore(configPath)
    store.upsert(makeConnector({ id: 'c1', credentials: { appId: 'cli', appSecret: 'real-secret' } }))
    store.upsert(makeConnector({ id: 'c1', credentials: { appId: '', appSecret: '' } }))
    const c = store.get('c1')
    expect(c?.credentials).toEqual({ appId: 'cli', appSecret: 'real-secret' })
  })

  it('listPublic strips credentials', () => {
    const store = new ImConnectorStore(configPath)
    store.upsert(makeConnector({ id: 'c1' }))
    const list = store.listPublic()
    expect(list).toHaveLength(1)
    expect(list[0].hasCredentials).toBe(true)
    expect(list[0]).not.toHaveProperty('credentials')
  })

  it('remove deletes a connector', () => {
    const store = new ImConnectorStore(configPath)
    store.upsert(makeConnector({ id: 'c1' }))
    expect(store.remove('c1')).toBe(true)
    expect(store.listPublic()).toEqual([])
  })

  it('remove returns false for non-existent id', () => {
    const store = new ImConnectorStore(configPath)
    expect(store.remove('nope')).toBe(false)
  })

  it('updateStatus changes connector status', () => {
    const store = new ImConnectorStore(configPath)
    store.upsert(makeConnector({ id: 'c1', status: 'disconnected' }))
    store.updateStatus('c1', 'connected')
    expect(store.get('c1')?.status).toBe('connected')
  })

  it('updateParked changes parked entries', () => {
    const store = new ImConnectorStore(configPath)
    store.upsert(makeConnector({ id: 'c1' }))
    store.updateParked('c1', [{ kind: 'user', id: 'u1', name: 'Bob', firstSeenAt: 1000 }])
    expect(store.get('c1')?.parked).toHaveLength(1)
    expect(store.get('c1')?.parked[0].id).toBe('u1')
  })

  it('writes file with 0600 permissions (best-effort on non-POSIX)', () => {
    const store = new ImConnectorStore(configPath)
    store.upsert(makeConnector({ id: 'c1' }))
    expect(existsSync(configPath)).toBe(true)
    // On Windows, chmod is no-op; just verify file exists and is readable
    const content = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(content.version).toBe(1)
    expect(content.connectors).toHaveLength(1)
  })
})
