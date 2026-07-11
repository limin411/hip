import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from '../persistence/open.js'
import { MemoryStore } from './store.js'
import { MemoryService } from './service.js'

/**
 * Lightweight integration: manual upsert → core snapshot includes the title.
 * Full multi-session inject/delete paths are covered in unit tests.
 */
describe('memory e2e integration (light)', () => {
  let dir: string
  let configPath: string
  let svc: MemoryService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hip-mem-e2e-'))
    configPath = join(dir, 'memory.json')
    const { db, memoriesFtsEnabled } = openDatabase(':memory:')
    const store = new MemoryStore(db, memoriesFtsEnabled)
    svc = new MemoryService(store, { configPath })
    svc.setConfig({ useMemories: true, generateMemories: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('manual upsert → loadCoreSnapshot contains title when pinned', () => {
    svc.upsert({
      title: 'Prefer yarn over npm',
      content: 'Always use yarn in this monorepo.',
      kind: 'preference',
      scope: 'global',
      pinned: true,
    })

    const snap = svc.loadCoreSnapshot(undefined)
    expect(snap).toContain('Prefer yarn over npm')
    expect(snap).toMatch(/Memory \(core\)/i)
  })
})
