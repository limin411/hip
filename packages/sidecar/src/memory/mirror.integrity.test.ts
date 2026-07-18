import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MEMORY_FILE_CONFIG_DEFAULTS } from '@hip/protocol'
import { openDatabase } from '../persistence/open.js'
import { MemoryStore } from './store.js'
import { MemoryService } from './service.js'
import { projectMemoryMirrorPath, globalMemoryMirrorPath } from './mirror.js'

describe('mirror integrity (PR1)', () => {
  let dir: string
  let configPath: string
  let prevEnv: string | undefined
  let svc: MemoryService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hip-mem-int-'))
    configPath = join(dir, 'memory.json')
    prevEnv = process.env.HIP_MEMORIES_DIR
    process.env.HIP_MEMORIES_DIR = join(dir, 'memories')
    const { db, memoriesFtsEnabled } = openDatabase(':memory:')
    svc = new MemoryService(new MemoryStore(db, memoriesFtsEnabled), { configPath })
    svc.setConfig({
      ...MEMORY_FILE_CONFIG_DEFAULTS,
      useMemories: true,
      generateMemories: true,
      exportMarkdownMirror: true,
    })
  })

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.HIP_MEMORIES_DIR
    else process.env.HIP_MEMORIES_DIR = prevEnv
    rmSync(dir, { recursive: true, force: true })
  })

  it('upsert then delete removes id from mirror and bumps generation', () => {
    const g0 = svc.getCoreGeneration()
    const item = svc.upsert({
      title: 'Prefer yarn',
      content: 'Always use yarn for this monorepo.',
      kind: 'preference',
      scope: 'global',
    })
    expect(svc.getCoreGeneration()).toBeGreaterThan(g0)
    const path = globalMemoryMirrorPath()
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toContain(item.id)

    svc.softDelete(item.id)
    expect(readFileSync(path, 'utf8')).not.toContain(item.id)
  })

  it('exportMarkdownMirror false skips disk but still bumps generation', () => {
    svc.setConfig({ exportMarkdownMirror: false })
    const g0 = svc.getCoreGeneration()
    svc.upsert({
      title: 'Silent',
      content: 'No mirror write',
      kind: 'lesson',
      scope: 'global',
    })
    expect(svc.getCoreGeneration()).toBeGreaterThan(g0)
    expect(existsSync(globalMemoryMirrorPath())).toBe(false)
  })

  it('rich core inject includes item body and capacity header', () => {
    svc.setConfig({ coreInjectionMode: 'rich' })
    svc.upsert({
      title: 'Yarn only',
      content: 'Use yarn exclusively for package installs.',
      kind: 'convention',
      scope: 'global',
    })
    const block = svc.loadCoreSnapshot(undefined)
    expect(block.text).toMatch(/Memory \(core\) \[\d+%/)
    expect(block.text).toContain('Use yarn exclusively')
    expect(block.ids.length).toBeGreaterThan(0)
  })

  it('project upsert writes project mirror path', () => {
    const hash = 'abc123deadbeef'
    svc.upsert({
      title: 'Go tests',
      content: 'go test ./... -count=1',
      kind: 'convention',
      scope: 'project',
      projectKeyHash: hash,
      projectKey: '/tmp/proj',
    })
    const path = projectMemoryMirrorPath(hash)
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toContain('go test')
  })
})
