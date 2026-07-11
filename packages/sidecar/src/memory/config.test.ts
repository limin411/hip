import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MEMORY_FILE_CONFIG_DEFAULTS } from '@hip/protocol'
import {
  loadMemoryConfig,
  saveMemoryConfig,
  resolveSessionMemoryFlags,
  memoryConfigPath,
} from './config.js'

describe('memoryConfigPath', () => {
  const prev = process.env.HIP_MEMORY_CONFIG_PATH
  const prevDataDir = process.env.HIP_DATA_DIR

  afterEach(() => {
    if (prev === undefined) delete process.env.HIP_MEMORY_CONFIG_PATH
    else process.env.HIP_MEMORY_CONFIG_PATH = prev
    if (prevDataDir === undefined) delete process.env.HIP_DATA_DIR
    else process.env.HIP_DATA_DIR = prevDataDir
  })

  it('honors HIP_MEMORY_CONFIG_PATH', () => {
    process.env.HIP_MEMORY_CONFIG_PATH = '/tmp/custom-memory.json'
    expect(memoryConfigPath()).toBe('/tmp/custom-memory.json')
  })

  it('honors HIP_DATA_DIR when HIP_MEMORY_CONFIG_PATH unset', () => {
    delete process.env.HIP_MEMORY_CONFIG_PATH
    const prevData = process.env.HIP_DATA_DIR
    process.env.HIP_DATA_DIR = '/tmp/hip-e2e-data'
    expect(memoryConfigPath()).toBe('/tmp/hip-e2e-data/config/memory.json')
    if (prevData === undefined) delete process.env.HIP_DATA_DIR
    else process.env.HIP_DATA_DIR = prevData
  })

  it('explicit override beats env', () => {
    process.env.HIP_MEMORY_CONFIG_PATH = '/tmp/env-memory.json'
    expect(memoryConfigPath('/tmp/override.json')).toBe('/tmp/override.json')
  })
})

describe('loadMemoryConfig / saveMemoryConfig', () => {
  let dir: string
  let path: string
  const prev = process.env.HIP_MEMORY_CONFIG_PATH

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hip-mem-cfg-'))
    path = join(dir, 'memory.json')
    process.env.HIP_MEMORY_CONFIG_PATH = path
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.HIP_MEMORY_CONFIG_PATH
    else process.env.HIP_MEMORY_CONFIG_PATH = prev
    rmSync(dir, { recursive: true, force: true })
  })

  it('missing file → defaults', () => {
    expect(existsSync(path)).toBe(false)
    const cfg = loadMemoryConfig()
    expect(cfg).toEqual(MEMORY_FILE_CONFIG_DEFAULTS)
    expect(cfg.useMemories).toBe(false)
    expect(cfg.generateMemories).toBe(false)
  })

  it('invalid JSON → defaults + does not throw', () => {
    writeFileSync(path, '{ not valid json', 'utf8')
    const cfg = loadMemoryConfig()
    expect(cfg.version).toBe(1)
    expect(cfg.useMemories).toBe(false)
  })

  it('merges missing keys with defaults', () => {
    writeFileSync(path, JSON.stringify({ version: 1, useMemories: true }), 'utf8')
    const cfg = loadMemoryConfig()
    expect(cfg.useMemories).toBe(true)
    expect(cfg.generateMemories).toBe(MEMORY_FILE_CONFIG_DEFAULTS.generateMemories)
    expect(cfg.maxCoreSummaryChars).toBe(MEMORY_FILE_CONFIG_DEFAULTS.maxCoreSummaryChars)
    expect(cfg.defaultScope).toBe('project')
  })

  it('saveMemoryConfig partial-merges and writes 0o600', () => {
    const saved = saveMemoryConfig({ useMemories: true, generateMemories: true })
    expect(saved.useMemories).toBe(true)
    expect(saved.generateMemories).toBe(true)
    expect(saved.maxCoreSummaryChars).toBe(MEMORY_FILE_CONFIG_DEFAULTS.maxCoreSummaryChars)

    const disk = JSON.parse(readFileSync(path, 'utf8')) as { useMemories: boolean }
    expect(disk.useMemories).toBe(true)

    const mode = statSync(path).mode & 0o777
    // On some CI filesystems mode bits may be umask-affected; require owner read/write only intent
    expect(mode & 0o077).toBe(0)
  })

  it('save then load round-trips', () => {
    saveMemoryConfig({ idleMinutes: 30, extractModel: 'openai/gpt-4o' })
    const cfg = loadMemoryConfig()
    expect(cfg.idleMinutes).toBe(30)
    expect(cfg.extractModel).toBe('openai/gpt-4o')
  })

  it('minExtractIntervalHours defaults to 6 and merges from partial', () => {
    expect(MEMORY_FILE_CONFIG_DEFAULTS.minExtractIntervalHours).toBe(6)
    expect(loadMemoryConfig().minExtractIntervalHours).toBe(6)
    saveMemoryConfig({ minExtractIntervalHours: 12 })
    expect(loadMemoryConfig().minExtractIntervalHours).toBe(12)
  })

  it('role-model / hybrid / trash defaults and merges', () => {
    const cfg = loadMemoryConfig()
    expect(cfg.hybridSearchEnabled).toBe(false)
    expect(cfg.maxExtractsPerDay).toBe(20)
    expect(cfg.trashRetentionDays).toBe(30)
    expect(cfg.embeddingModel).toBeUndefined()
    expect(cfg.rerankModel).toBeUndefined()

    saveMemoryConfig({
      hybridSearchEnabled: true,
      maxExtractsPerDay: 5,
      trashRetentionDays: 14,
      embeddingModel: { providerID: 'openai', modelID: 'text-embedding-3-small' },
      rerankModel: { providerID: 'openai', modelID: 'gpt-4o-mini' },
      extractModel: { providerID: 'deepseek', modelID: 'deepseek-chat' },
    })
    const loaded = loadMemoryConfig()
    expect(loaded.hybridSearchEnabled).toBe(true)
    expect(loaded.maxExtractsPerDay).toBe(5)
    expect(loaded.trashRetentionDays).toBe(14)
    expect(loaded.embeddingModel).toEqual({
      providerID: 'openai',
      modelID: 'text-embedding-3-small',
    })
    expect(loaded.rerankModel).toEqual({ providerID: 'openai', modelID: 'gpt-4o-mini' })
    expect(loaded.extractModel).toEqual({ providerID: 'deepseek', modelID: 'deepseek-chat' })
  })

  it('clears optional role models with null', () => {
    saveMemoryConfig({
      extractModel: { providerID: 'openai', modelID: 'gpt-4o-mini' },
      embeddingModel: { providerID: 'openai', modelID: 'text-embedding-3-small' },
    })
    saveMemoryConfig({
      extractModel: null as unknown as undefined,
      embeddingModel: null as unknown as undefined,
    })
    const cfg = loadMemoryConfig()
    expect(cfg.extractModel).toBeUndefined()
    expect(cfg.embeddingModel).toBeUndefined()
  })

  it('still accepts legacy string extractModel', () => {
    saveMemoryConfig({ extractModel: 'openai/gpt-4o-mini' })
    expect(loadMemoryConfig().extractModel).toBe('openai/gpt-4o-mini')
  })
})

describe('resolveSessionMemoryFlags', () => {
  const globalOn = {
    ...MEMORY_FILE_CONFIG_DEFAULTS,
    useMemories: true,
    generateMemories: true,
  }
  const globalOff = {
    ...MEMORY_FILE_CONFIG_DEFAULTS,
    useMemories: false,
    generateMemories: false,
  }

  it('incognito forces both false', () => {
    expect(resolveSessionMemoryFlags(globalOn, { incognito: true })).toEqual({
      use: false,
      generate: false,
      incognito: true,
    })
    expect(
      resolveSessionMemoryFlags(globalOn, {
        useMemories: true,
        generateMemories: true,
        incognito: true,
      }),
    ).toEqual({ use: false, generate: false, incognito: true })
  })

  it('session override beats global', () => {
    expect(
      resolveSessionMemoryFlags(globalOff, { useMemories: true, generateMemories: true }),
    ).toEqual({ use: true, generate: true, incognito: false })
    expect(
      resolveSessionMemoryFlags(globalOn, { useMemories: false, generateMemories: false }),
    ).toEqual({ use: false, generate: false, incognito: false })
  })

  it('inherits global when session fields undefined', () => {
    expect(resolveSessionMemoryFlags(globalOn, {})).toEqual({
      use: true,
      generate: true,
      incognito: false,
    })
    expect(resolveSessionMemoryFlags(globalOff, {})).toEqual({
      use: false,
      generate: false,
      incognito: false,
    })
  })

  it('partial session override only affects provided field', () => {
    expect(resolveSessionMemoryFlags(globalOn, { useMemories: false })).toEqual({
      use: false,
      generate: true,
      incognito: false,
    })
  })
})
