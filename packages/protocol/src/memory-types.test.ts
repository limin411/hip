import { describe, it, expect } from 'vitest'
import { MEMORY_FILE_CONFIG_DEFAULTS, type MemoryItem, type MemoryCitation } from './memory-types.js'

describe('memory-types', () => {
  it('MEMORY_FILE_CONFIG_DEFAULTS has version 1 and flags off by default', () => {
    expect(MEMORY_FILE_CONFIG_DEFAULTS.version).toBe(1)
    expect(MEMORY_FILE_CONFIG_DEFAULTS.useMemories).toBe(false)
    expect(MEMORY_FILE_CONFIG_DEFAULTS.generateMemories).toBe(false)
    expect(MEMORY_FILE_CONFIG_DEFAULTS.defaultScope).toBe('project')
  })

  it('MemoryItem and MemoryCitation shapes are assignable', () => {
    const item: MemoryItem = {
      id: 'm1',
      scope: 'project',
      kind: 'preference',
      title: 'Prefer TypeScript',
      content: 'Use TS strict mode',
      confidence: 0.9,
      status: 'active',
      source: 'user',
      tags: ['lang'],
      createdAt: 1,
      updatedAt: 1,
      useCount: 0,
      pinned: false,
    }
    const cite: MemoryCitation = { memoryId: item.id, title: item.title }
    expect(cite.memoryId).toBe('m1')
  })
})
