import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentConfig } from '@hip/protocol'
import { readAgentsConfig, resolveAgentModel } from './registry.js'

const tmps: string[] = []
function writeFile(name: string, obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'hip-agents-')); tmps.push(dir)
  const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
  delete process.env.HIP_AGENTS_PATH; delete process.env.HIP_PROVIDERS_PATH; delete process.env.HIP_MODEL_ACME_API_KEY
})

const baseAgent: AgentConfig = { id: 'a1', name: 'A', kind: 'custom', command: 'x', args: [], transport: 'thin', acceptsModelConfig: false, enabled: true }

describe('readAgentsConfig', () => {
  it('returns [] when HIP_AGENTS_PATH is unset', () => {
    delete process.env.HIP_AGENTS_PATH
    expect(readAgentsConfig()).toEqual([])
  })
  it('reads the agents array from the file', () => {
    process.env.HIP_AGENTS_PATH = writeFile('hip-agents.json', { agents: [baseAgent] })
    expect(readAgentsConfig()).toEqual([baseAgent])
  })
  it('returns [] on a corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-agents-')); tmps.push(dir)
    const p = join(dir, 'hip-agents.json'); writeFileSync(p, '{ not json'); process.env.HIP_AGENTS_PATH = p
    expect(readAgentsConfig()).toEqual([])
  })
})

describe('resolveAgentModel', () => {
  it('returns null when the agent has no bound model', () => {
    expect(resolveAgentModel(baseAgent)).toBeNull()
  })
  it('resolves baseURL (providers file) + apiKey (env) for the bound model', () => {
    process.env.HIP_PROVIDERS_PATH = writeFile('hip-providers.json', { providers: { acme: { enabled: true, baseURL: 'https://acme.test/v1' } } })
    process.env.HIP_MODEL_ACME_API_KEY = 'sk-acme'
    const agent: AgentConfig = { ...baseAgent, acceptsModelConfig: true, boundModel: { providerID: 'acme', modelID: 'acme-large' } }
    expect(resolveAgentModel(agent)).toEqual({ providerID: 'acme', modelID: 'acme-large', baseURL: 'https://acme.test/v1', apiKey: 'sk-acme' })
  })
})
