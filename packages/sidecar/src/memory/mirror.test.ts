import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { MemoryFileConfig, MemoryItem } from '@hip/protocol'
import { MEMORY_FILE_CONFIG_DEFAULTS } from '@hip/protocol'
import { openDatabase } from '../persistence/open.js'
import { MemoryStore } from './store.js'
import {
  atomicWriteFile,
  formatMemoryMirrorMarkdown,
  projectMemoryMirrorPath,
  globalMemoryMirrorPath,
  writeMemoryMirror,
} from './mirror.js'

function cfg(partial: Partial<MemoryFileConfig> = {}): MemoryFileConfig {
  return { ...MEMORY_FILE_CONFIG_DEFAULTS, exportMarkdownMirror: true, ...partial }
}

function loadStore() {
  const { db, memoriesFtsEnabled } = openDatabase(':memory:')
  return new MemoryStore(db, memoriesFtsEnabled)
}

describe('mirror', () => {
  let dir: string
  let prevEnv: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hip-mem-mirror-'))
    prevEnv = process.env.HIP_MEMORIES_DIR
    process.env.HIP_MEMORIES_DIR = dir
  })

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.HIP_MEMORIES_DIR
    else process.env.HIP_MEMORIES_DIR = prevEnv
    rmSync(dir, { recursive: true, force: true })
  })

  it('atomicWriteFile uses temp+rename (final path has content)', () => {
    const target = join(dir, 'sub', 'out.md')
    atomicWriteFile(target, 'hello atomic\n')
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe('hello atomic\n')
  })

  it('writeMemoryMirror writes global and project MEMORY.md', () => {
    const store = loadStore()
    const now = Date.now()
    const g: MemoryItem = {
      id: 'g1',
      scope: 'global',
      kind: 'preference',
      title: 'Global tip',
      content: 'Use dark mode',
      confidence: 0.7,
      status: 'active',
      source: 'consolidate',
      tags: [],
      createdAt: now,
      updatedAt: now,
      useCount: 0,
      pinned: false,
    }
    const p: MemoryItem = {
      id: 'p1',
      scope: 'project',
      projectKeyHash: 'abc123',
      kind: 'convention',
      title: 'Yarn',
      content: 'yarn only',
      confidence: 0.6,
      status: 'active',
      source: 'consolidate',
      tags: [],
      createdAt: now,
      updatedAt: now,
      useCount: 0,
      pinned: false,
    }
    store.upsertItem(g)
    store.upsertItem(p)
    store.upsertSummary({
      id: 'summary:global',
      scope: 'global',
      summaryMd: 'v1\nGlobal prefs',
      updatedAt: now,
    })
    store.upsertSummary({
      id: 'summary:project:abc123',
      scope: 'project',
      projectKeyHash: 'abc123',
      summaryMd: 'v1\nProject yarn',
      updatedAt: now,
    })

    const gPath = writeMemoryMirror({
      store,
      config: cfg(),
      summaryMd: 'v1\nGlobal prefs',
    })
    expect(gPath).toBe(globalMemoryMirrorPath())
    const gBody = readFileSync(gPath!, 'utf8')
    expect(gBody).toContain('# MEMORY')
    expect(gBody).toContain('Global tip')
    expect(gBody).toContain('Global prefs')

    const pPath = writeMemoryMirror({
      store,
      config: cfg(),
      projectKeyHash: 'abc123',
      summaryMd: 'v1\nProject yarn',
    })
    expect(pPath).toBe(projectMemoryMirrorPath('abc123'))
    const pBody = readFileSync(pPath!, 'utf8')
    expect(pBody).toContain('Yarn')
    expect(pBody).toContain('yarn only')
  })

  it('skips when exportMarkdownMirror is false', () => {
    const store = loadStore()
    const path = writeMemoryMirror({
      store,
      config: cfg({ exportMarkdownMirror: false }),
      summaryMd: 'v1\nx',
    })
    expect(path).toBeNull()
  })

  it('formatMemoryMirrorMarkdown includes summary and items', () => {
    const md = formatMemoryMirrorMarkdown('v1\nSum', [
      {
        id: '1',
        scope: 'global',
        kind: 'preference',
        title: 'T',
        content: 'Body',
        confidence: 0.5,
        status: 'active',
        source: 'user',
        tags: [],
        createdAt: 1,
        updatedAt: 1,
        useCount: 0,
        pinned: false,
      },
    ])
    expect(md).toContain('## Summary')
    expect(md).toContain('### T')
    expect(md).toContain('Body')
  })

  it('atomic write overwrites existing file cleanly', () => {
    const target = join(dir, 'MEMORY.md')
    writeFileSync(target, 'old')
    atomicWriteFile(target, 'new content\n')
    expect(readFileSync(target, 'utf8')).toBe('new content\n')
  })
})
