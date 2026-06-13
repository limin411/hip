import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getActiveModel, setActiveModel, loadActiveModelFromEnv, isOpenAICompatible, DEEPSEEK_DEFAULT, cheapModelFor } from './providers.js'
import { providerKeyEnv } from '@hip/protocol'

describe('cheapModelFor', () => {
  it('maps deepseek to its cheap chat model', () => {
    expect(cheapModelFor('deepseek', 'deepseek-reasoner')).toBe('deepseek-chat')
  })
  it('falls back to the active model for unknown providers', () => {
    expect(cheapModelFor('acme', 'acme-large')).toBe('acme-large')
  })
})

describe('sidecar provider config', () => {
  beforeEach(() => setActiveModel(DEEPSEEK_DEFAULT))
  afterEach(() => { delete process.env.HIP_PROVIDERS_PATH })

  it('providerKeyEnv normalises ids', () => {
    expect(providerKeyEnv('deepseek')).toBe('HIP_MODEL_DEEPSEEK_API_KEY')
    expect(providerKeyEnv('github-copilot')).toBe('HIP_MODEL_GITHUB_COPILOT_API_KEY')
  })

  it('defaults to deepseek when no providers file is set', () => {
    delete process.env.HIP_PROVIDERS_PATH
    loadActiveModelFromEnv()
    expect(getActiveModel()).toEqual(DEEPSEEK_DEFAULT)
  })

  it('reads active model + base URL from the providers file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-prov-'))
    const file = join(dir, 'hip-providers.json')
    writeFileSync(file, JSON.stringify({
      providers: { openai: { enabled: true, baseURL: 'https://api.openai.com/v1' } },
      activeModel: { providerID: 'openai', modelID: 'gpt-4o' },
    }))
    process.env.HIP_PROVIDERS_PATH = file
    loadActiveModelFromEnv()
    expect(getActiveModel()).toEqual({ providerID: 'openai', modelID: 'gpt-4o', baseURL: 'https://api.openai.com/v1' })
  })

  it('setActiveModel/getActiveModel round-trip', () => {
    setActiveModel({ providerID: 'groq', modelID: 'llama-3.3-70b', baseURL: 'https://api.groq.com/openai/v1' })
    expect(getActiveModel().providerID).toBe('groq')
  })

  it('isOpenAICompatible blocks native-only providers and admits everything else', () => {
    // The renderer-disabled (native-SDK) providers — the only ones a stale hip-providers.json can sneak in.
    expect(isOpenAICompatible('anthropic')).toBe(false)
    expect(isOpenAICompatible('google')).toBe(false)
    expect(isOpenAICompatible('google-vertex')).toBe(false)
    expect(isOpenAICompatible('amazon-bedrock')).toBe(false)
    expect(isOpenAICompatible('azure')).toBe(false)
    // OpenAI-compatible providers + unknown/custom ids default to runnable (blocklist, not allowlist,
    // so npm-tagged openai-compatible providers the UI admits are never wrongly rejected here).
    expect(isOpenAICompatible('deepseek')).toBe(true)
    expect(isOpenAICompatible('openai')).toBe(true)
    expect(isOpenAICompatible('groq')).toBe(true)
    expect(isOpenAICompatible('some-self-hosted-vendor')).toBe(true)
  })
})
