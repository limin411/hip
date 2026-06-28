import { describe, it, expect } from 'vitest'
import { isAttachmentSupported, findMultimodalAgentModelKey } from './attachmentEligibility'
import type { Catalog } from '@/ipc/catalog'
import type { AgentConfig } from '@hip/protocol'

const catalog: Catalog = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    env: [],
    models: {
      'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', attachment: true },
      'gpt-4': { id: 'gpt-4', name: 'GPT-4', attachment: false },
    },
  },
}

function agent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'a1',
    name: 'Agent',
    kind: 'internal',
    command: '',
    args: [],
    enabled: true,
    ...overrides,
  } as AgentConfig
}

describe('isAttachmentSupported', () => {
  it('returns true when current model is multimodal', () => {
    expect(isAttachmentSupported('openai/gpt-4o', [], catalog)).toBe(true)
  })

  it('returns false when current model is not multimodal and no agents', () => {
    expect(isAttachmentSupported('openai/gpt-4', [], catalog)).toBe(false)
  })

  it('returns true when an internal sub-agent has a multimodal bound model', () => {
    const agents = [agent({ boundModel: { providerID: 'openai', modelID: 'gpt-4o' } })]
    expect(isAttachmentSupported('openai/gpt-4', agents, catalog)).toBe(true)
  })

  it('ignores external agents', () => {
    const agents = [agent({ kind: 'acp', boundModel: { providerID: 'openai', modelID: 'gpt-4o' } })]
    expect(isAttachmentSupported('openai/gpt-4', agents, catalog)).toBe(false)
  })

  it('ignores disabled or builtin agents', () => {
    const agents = [
      agent({ id: 'builtin', enabled: true, boundModel: { providerID: 'openai', modelID: 'gpt-4o' } }),
      agent({ enabled: false, boundModel: { providerID: 'openai', modelID: 'gpt-4o' } }),
    ]
    expect(isAttachmentSupported('openai/gpt-4', agents, catalog)).toBe(false)
  })
})

describe('findMultimodalAgentModelKey', () => {
  it('returns undefined when no agents are multimodal', () => {
    expect(findMultimodalAgentModelKey([], catalog)).toBeUndefined()
    expect(findMultimodalAgentModelKey([agent({ boundModel: { providerID: 'openai', modelID: 'gpt-4' } })], catalog)).toBeUndefined()
  })

  it('returns the first enabled internal agent with a multimodal bound model', () => {
    const agents = [
      agent({ id: 'a1', boundModel: { providerID: 'openai', modelID: 'gpt-4' } }),
      agent({ id: 'a2', boundModel: { providerID: 'openai', modelID: 'gpt-4o' } }),
    ]
    expect(findMultimodalAgentModelKey(agents, catalog)).toBe('openai/gpt-4o')
  })

  it('ignores external agents and builtin/disabled agents', () => {
    const agents = [
      agent({ id: 'builtin', enabled: true, boundModel: { providerID: 'openai', modelID: 'gpt-4o' } }),
      agent({ id: 'acp1', kind: 'acp', boundModel: { providerID: 'openai', modelID: 'gpt-4o' } }),
      agent({ id: 'disabled', enabled: false, boundModel: { providerID: 'openai', modelID: 'gpt-4o' } }),
    ]
    expect(findMultimodalAgentModelKey(agents, catalog)).toBeUndefined()
  })
})
