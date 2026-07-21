import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { reviewPluginModels, isBoundModelAvailable } from './plugin-model-review.js'

describe('isBoundModelAvailable', () => {
  it('rejects unknown or disabled providers', () => {
    const avail = {
      providers: { deepseek: true, openai: false },
      modelsByProvider: {},
    }
    expect(isBoundModelAvailable({ providerID: 'deepseek', modelID: 'x' }, avail)).toBe(true)
    expect(isBoundModelAvailable({ providerID: 'openai', modelID: 'x' }, avail)).toBe(false)
    expect(isBoundModelAvailable({ providerID: 'missing', modelID: 'x' }, avail)).toBe(false)
  })
})

describe('reviewPluginModels', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hip-model-review-'))
    mkdirSync(join(dir, '.plugin'), { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rewrites unavailable boundModel to default', () => {
    writeFileSync(
      join(dir, '.plugin', 'plugin.json'),
      JSON.stringify({
        name: 'p',
        version: '1.0.0',
        agents: [
          {
            id: 'a1',
            name: 'A',
            kind: 'internal',
            command: '',
            args: [],
            enabled: true,
            boundModel: { providerID: 'anthropic', modelID: 'claude-opus-4' },
          },
        ],
      }),
      'utf8',
    )

    const summary = reviewPluginModels(dir, {
      activeModel: {
        providerID: 'deepseek',
        modelID: 'deepseek-chat',
        baseURL: 'https://api.deepseek.com/v1',
      },
      availability: {
        providers: { deepseek: true },
        modelsByProvider: {},
      },
    })

    expect(summary.status).toBe('rewritten')
    expect(summary.findings[0].action).toBe('rewrite_to_default')
    const body = JSON.parse(readFileSync(join(dir, '.plugin', 'plugin.json'), 'utf8'))
    expect(body.agents[0].boundModel).toEqual({
      providerID: 'deepseek',
      modelID: 'deepseek-chat',
    })
  })

  it('keeps available boundModel', () => {
    writeFileSync(
      join(dir, '.plugin', 'plugin.json'),
      JSON.stringify({
        name: 'p',
        version: '1.0.0',
        agents: [
          {
            id: 'a1',
            name: 'A',
            kind: 'internal',
            command: '',
            args: [],
            enabled: true,
            boundModel: { providerID: 'deepseek', modelID: 'deepseek-chat' },
          },
        ],
      }),
      'utf8',
    )

    const summary = reviewPluginModels(dir, {
      activeModel: {
        providerID: 'deepseek',
        modelID: 'deepseek-chat',
        baseURL: 'https://api.deepseek.com/v1',
      },
      availability: {
        providers: { deepseek: true },
        modelsByProvider: {},
      },
    })

    expect(summary.status).toBe('ok')
    expect(summary.findings[0].action).toBe('keep')
  })
})
