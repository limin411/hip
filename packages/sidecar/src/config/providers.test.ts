import { describe, it, expect, beforeEach } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getActiveModel, setActiveModel, loadActiveModelFromEnv, DEEPSEEK_DEFAULT } from './providers.js'
import { providerKeyEnv } from '@hip/protocol'

describe('sidecar provider config', () => {
  beforeEach(() => setActiveModel(DEEPSEEK_DEFAULT))

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
})
