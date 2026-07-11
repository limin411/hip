import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseJsonFromLlmText, resolveMemoryExtractModel } from './llm-client.js'
import { setActiveModel } from '../config/providers.js'
import { saveMemoryConfig } from './config.js'

describe('parseJsonFromLlmText', () => {
  it('parses plain JSON', () => {
    expect(parseJsonFromLlmText('{"raw_memory":"a","rollout_summary":"b"}')).toEqual({
      raw_memory: 'a',
      rollout_summary: 'b',
    })
  })

  it('strips markdown fences', () => {
    const raw = '```json\n{"raw_memory":"","rollout_summary":""}\n```'
    expect(parseJsonFromLlmText(raw)).toEqual({ raw_memory: '', rollout_summary: '' })
  })

  it('extracts first object when trailing prose', () => {
    expect(parseJsonFromLlmText('Here you go: {"raw_memory":"x","rollout_summary":"y"} thanks')).toEqual({
      raw_memory: 'x',
      rollout_summary: 'y',
    })
  })
})

describe('resolveMemoryExtractModel', () => {
  let dir: string
  let path: string
  const prev = process.env.HIP_MEMORY_CONFIG_PATH

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hip-mem-llm-'))
    path = join(dir, 'memory.json')
    process.env.HIP_MEMORY_CONFIG_PATH = path
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.HIP_MEMORY_CONFIG_PATH
    else process.env.HIP_MEMORY_CONFIG_PATH = prev
    rmSync(dir, { recursive: true, force: true })
  })

  it('uses cheap model for active provider when no override', () => {
    setActiveModel({ providerID: 'deepseek', modelID: 'deepseek-reasoner', baseURL: 'https://api.deepseek.com' })
    const c = resolveMemoryExtractModel()
    expect(c.providerID).toBe('deepseek')
    expect(c.modelID).toBe('deepseek-chat')
  })

  it('parses provider/model override', () => {
    setActiveModel({ providerID: 'deepseek', modelID: 'deepseek-chat', baseURL: 'https://api.deepseek.com' })
    const c = resolveMemoryExtractModel('openai/gpt-4o-mini')
    expect(c.providerID).toBe('openai')
    expect(c.modelID).toBe('gpt-4o-mini')
  })

  it('maps bare model id via normalizeExtractModel (openai last resort)', () => {
    setActiveModel({ providerID: 'openai', modelID: 'gpt-4o', baseURL: 'https://api.openai.com/v1' })
    const c = resolveMemoryExtractModel('gpt-4o-mini')
    expect(c.providerID).toBe('openai')
    expect(c.modelID).toBe('gpt-4o-mini')
  })

  it('accepts MemoryModelRef override', () => {
    setActiveModel({ providerID: 'deepseek', modelID: 'deepseek-chat', baseURL: 'https://api.deepseek.com' })
    const c = resolveMemoryExtractModel({
      providerID: 'openai',
      modelID: 'gpt-4o-mini',
      baseURL: 'https://api.openai.com/v1',
    })
    expect(c).toEqual({
      providerID: 'openai',
      modelID: 'gpt-4o-mini',
      baseURL: 'https://api.openai.com/v1',
    })
  })

  it('falls back to memory.json extractModel when override empty', () => {
    setActiveModel({ providerID: 'deepseek', modelID: 'deepseek-reasoner', baseURL: 'https://api.deepseek.com' })
    saveMemoryConfig({ extractModel: { providerID: 'openai', modelID: 'gpt-4o-mini' } })
    const c = resolveMemoryExtractModel()
    expect(c.providerID).toBe('openai')
    expect(c.modelID).toBe('gpt-4o-mini')
  })
})

describe('MemoryLlmClient isolation', () => {
  it('module does not import RealModelRunner / model-runner', async () => {
    // Static guarantee: llm-client must never pull session ModelRunner.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./llm-client.ts', import.meta.url), 'utf8'),
    )
    expect(src).not.toMatch(/from ['"].*model-runner/)
    expect(src).not.toMatch(/import\s*\{[^}]*RealModelRunner/)
  })
})
