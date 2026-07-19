import { describe, it, expect } from 'vitest'
import { extractAcpConfigOptions, patchConfigOptionValue } from './acp-session-options.js'

describe('extractAcpConfigOptions', () => {
  it('prefers standard configOptions when present', () => {
    const opts = extractAcpConfigOptions({
      configOptions: [
        {
          type: 'select',
          id: 'model',
          name: 'Model',
          category: 'model',
          currentValue: 'a',
          options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }],
        },
      ],
      models: {
        currentModelId: 'should-ignore',
        availableModels: [{ modelId: 'should-ignore', name: 'X' }],
      },
    })
    expect(opts).toHaveLength(1)
    expect(opts[0]!.currentValue).toBe('a')
    expect(opts[0]!.options.map((o) => o.value)).toEqual(['a', 'b'])
  })

  it('synthesizes model + effort selects from Grok-style models payload', () => {
    const opts = extractAcpConfigOptions({
      sessionId: 's1',
      models: {
        currentModelId: 'grok-4.5',
        availableModels: [
          {
            modelId: 'grok-4.5',
            name: 'Grok 4.5',
            description: 'frontier',
            _meta: {
              reasoningEffort: 'high',
              reasoningEfforts: [
                { id: 'high', value: 'high', label: 'High Effort', description: 'best', default: true },
                { id: 'medium', value: 'medium', label: 'Medium Effort', default: false },
                { id: 'low', value: 'low', label: 'Low Effort', default: false },
              ],
            },
          },
        ],
      },
    })
    expect(opts).toEqual([
      {
        type: 'select',
        id: 'model',
        name: 'Model',
        category: 'model',
        currentValue: 'grok-4.5',
        options: [{ value: 'grok-4.5', name: 'Grok 4.5', description: 'frontier' }],
      },
      {
        type: 'select',
        id: 'mode',
        name: 'Effort',
        category: 'mode',
        currentValue: 'high',
        options: [
          { value: 'high', name: 'High Effort', description: 'best' },
          { value: 'medium', name: 'Medium Effort' },
          { value: 'low', name: 'Low Effort' },
        ],
      },
    ])
  })

  it('returns empty for null / missing payloads', () => {
    expect(extractAcpConfigOptions(null)).toEqual([])
    expect(extractAcpConfigOptions({})).toEqual([])
    expect(extractAcpConfigOptions({ models: { availableModels: [] } })).toEqual([])
  })

  it('skips non-select configOptions', () => {
    expect(
      extractAcpConfigOptions({
        configOptions: [{ type: 'text', id: 'x' }, { type: 'select', id: 'm', name: 'M', currentValue: '1', options: [{ value: '1', name: 'One' }] }],
      }),
    ).toMatchObject([{ id: 'm', currentValue: '1' }])
  })
})

describe('patchConfigOptionValue', () => {
  it('updates only the matching option id', () => {
    const base = extractAcpConfigOptions({
      configOptions: [
        { type: 'select', id: 'model', name: 'Model', currentValue: 'a', options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] },
        { type: 'select', id: 'mode', name: 'Mode', currentValue: 'high', options: [{ value: 'high', name: 'H' }, { value: 'low', name: 'L' }] },
      ],
    })
    const next = patchConfigOptionValue(base, 'mode', 'low')
    expect(next.find((o) => o.id === 'model')!.currentValue).toBe('a')
    expect(next.find((o) => o.id === 'mode')!.currentValue).toBe('low')
    // original unchanged
    expect(base.find((o) => o.id === 'mode')!.currentValue).toBe('high')
  })
})
