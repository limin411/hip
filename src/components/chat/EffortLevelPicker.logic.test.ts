import { describe, it, expect } from 'vitest'
import { effortLevelsForKey, resolveEffort } from '@/lib/modelEffort'
import type { Catalog } from '@/ipc/catalog'

const catalog: Catalog = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    env: [],
    models: {
      'gpt-5.4': {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        reasoning: true,
        reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh'] }],
      },
      'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', reasoning: false },
    },
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    env: [],
    models: {
      'claude-opus-4-8': {
        id: 'claude-opus-4-8',
        name: 'Claude Opus 4.8',
        reasoning: true,
        reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }],
      },
    },
  },
}

describe('EffortLevelPicker dynamic levels', () => {
  it('shows openai effort list for gpt-5.4', () => {
    expect(effortLevelsForKey(catalog, 'openai/gpt-5.4')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
  })

  it('hides picker for models without effort options', () => {
    expect(effortLevelsForKey(catalog, 'openai/gpt-4o')).toBeNull()
  })

  it('shows anthropic max-inclusive list', () => {
    expect(effortLevelsForKey(catalog, 'anthropic/claude-opus-4-8')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  })

  it('clamps stored effort when switching models', () => {
    const openai = effortLevelsForKey(catalog, 'openai/gpt-5.4')!
    const anthropic = effortLevelsForKey(catalog, 'anthropic/claude-opus-4-8')!
    expect(resolveEffort('none', openai)).toBe('none')
    // none is not on Anthropic list → default medium
    expect(resolveEffort('none', anthropic)).toBe('medium')
    expect(resolveEffort('max', openai)).toBe('medium')
    expect(resolveEffort('max', anthropic)).toBe('max')
  })
})
