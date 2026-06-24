import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getActiveModel, setActiveModel, loadActiveModelFromEnv, isOpenAICompatible, DEEPSEEK_DEFAULT, cheapModelFor, resolveProviderBaseURL } from './providers.js'
import { providerKeyEnv } from '@hip/protocol'

const tmps: string[] = []
function writeToml(enabled: Record<string, boolean> = { deepseek: true }, active?: { providerID: string; modelID: string; baseURL: string }): string {
  const dir = mkdtempSync(join(tmpdir(), 'hip-prov-'))
  tmps.push(dir)
  const entries = Object.entries(enabled).map(([id, on]) => `[[providers]]\nid = "${id}"\nname = "${id}"\nbaseUrl = "https://${id}.test/v1"\nenabled = ${on}`).join('\n\n')
  const activeBlock = active ? `\n\n[activeModel]\nproviderID = "${active.providerID}"\nmodelID = "${active.modelID}"\nbaseURL = "${active.baseURL}"` : ''
  writeFileSync(join(dir, 'hip.toml'), `version = 1\n\n${entries}${activeBlock}`)
  return join(dir, 'hip.toml')
}

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
  afterEach(() => {
    delete process.env.HIP_CONFIG_PATH
    for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('providerKeyEnv normalises ids', () => {
    expect(providerKeyEnv('deepseek')).toBe('HIP_MODEL_DEEPSEEK_API_KEY')
    expect(providerKeyEnv('github-copilot')).toBe('HIP_MODEL_GITHUB_COPILOT_API_KEY')
  })

  it('defaults to deepseek when no config file is set', () => {
    delete process.env.HIP_CONFIG_PATH
    loadActiveModelFromEnv()
    expect(getActiveModel()).toEqual(DEEPSEEK_DEFAULT)
  })

  it('reads active model + base URL from hip.toml', () => {
    process.env.HIP_CONFIG_PATH = writeToml({ openai: true }, { providerID: 'openai', modelID: 'gpt-4o', baseURL: 'https://api.openai.com/v1' })
    loadActiveModelFromEnv()
    expect(getActiveModel()).toEqual({ providerID: 'openai', modelID: 'gpt-4o', baseURL: 'https://api.openai.com/v1' })
  })

  it('setActiveModel/getActiveModel round-trip', () => {
    setActiveModel({ providerID: 'groq', modelID: 'llama-3.3-70b', baseURL: 'https://api.groq.com/openai/v1' })
    expect(getActiveModel().providerID).toBe('groq')
  })

  it('isOpenAICompatible blocks native-only providers and admits everything else', () => {
    expect(isOpenAICompatible('anthropic')).toBe(true)
    expect(isOpenAICompatible('google')).toBe(false)
    expect(isOpenAICompatible('google-vertex')).toBe(false)
    expect(isOpenAICompatible('amazon-bedrock')).toBe(false)
    expect(isOpenAICompatible('azure')).toBe(false)
    expect(isOpenAICompatible('deepseek')).toBe(true)
    expect(isOpenAICompatible('openai')).toBe(true)
    expect(isOpenAICompatible('groq')).toBe(true)
    expect(isOpenAICompatible('some-self-hosted-vendor')).toBe(true)
  })
})

describe('resolveProviderBaseURL', () => {
  afterEach(() => {
    delete process.env.HIP_CONFIG_PATH
    for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('reads the providers baseURL from hip.toml', () => {
    process.env.HIP_CONFIG_PATH = writeToml({ acme: true })
    expect(resolveProviderBaseURL('acme')).toBe('https://acme.test/v1')
  })
  it('falls back to the deepseek default when the provider/file is missing', () => {
    delete process.env.HIP_CONFIG_PATH
    expect(resolveProviderBaseURL('whatever')).toBe('https://api.deepseek.com/v1')
  })
})
