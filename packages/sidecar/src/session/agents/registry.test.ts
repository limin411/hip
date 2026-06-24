import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentConfig } from '@hip/protocol'
import { readAgentsConfig, resolveAgentModel } from './registry.js'

const tmps: string[] = []
function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hip-agents-'))
  tmps.push(dir)
  return dir
}
function writeToml(dir: string, name: string, content: string): string {
  const p = join(dir, name)
  writeFileSync(p, content)
  return p
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
  delete process.env.HIP_CONFIG_PATH
  delete process.env.HIP_MODEL_ACME_API_KEY
})

const baseAgent: AgentConfig = { id: 'a1', name: 'A', kind: 'acp', command: 'x', args: [], enabled: true }

describe('readAgentsConfig', () => {
  it('returns [] when no hip.toml exists', () => {
    const dir = tmpDir()
    expect(readAgentsConfig(dir)).toEqual([])
  })

  it('reads agents from global hip.toml (HIP_CONFIG_PATH)', () => {
    const dir = tmpDir()
    const toml = writeToml(dir, 'hip.toml', `version = 1\n[[agents]]\nid = "a1"\nname = "A"\nkind = "acp"\ncommand = "x"\nargs = []\nenabled = true\n`)
    process.env.HIP_CONFIG_PATH = toml
    expect(readAgentsConfig(tmpDir())).toEqual([baseAgent])
  })

  it('reads agents from project-level .hip/hip.toml', () => {
    const dir = tmpDir()
    const projectHipDir = join(dir, '.hip')
    mkdirSync(projectHipDir, { recursive: true })
    writeToml(projectHipDir, 'hip.toml', `version = 1\n[[agents]]\nid = "a2"\nname = "B"\nkind = "custom"\ncommand = "y"\nargs = []\nenabled = false\n`)
    expect(readAgentsConfig(dir)).toEqual([
      { id: 'a2', name: 'B', kind: 'custom', command: 'y', args: [], enabled: false },
    ])
  })
})

describe('resolveAgentModel', () => {
  it('returns null when the agent has no bound model', () => {
    expect(resolveAgentModel(baseAgent)).toBeNull()
  })
  it('resolves baseURL (hip.toml) + apiKey (env) for the bound model', () => {
    const dir = tmpDir()
    const cfg = writeToml(dir, 'hip.toml', `version = 1
[[providers]]
id = "acme"
name = "Acme"
baseUrl = "https://acme.test/v1"
enabled = true
`)
    process.env.HIP_CONFIG_PATH = cfg
    process.env.HIP_MODEL_ACME_API_KEY = 'sk-acme'
    const agent: AgentConfig = { ...baseAgent, boundModel: { providerID: 'acme', modelID: 'acme-large' } }
    expect(resolveAgentModel(agent)).toEqual({ providerID: 'acme', modelID: 'acme-large', baseURL: 'https://acme.test/v1', apiKey: 'sk-acme' })
  })
})
