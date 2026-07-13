import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))

beforeEach(() => invoke.mockReset())

describe('knowledge IPC', () => {
  it('knowledgeListSpaces returns spaces', async () => {
    const { knowledgeListSpaces } = await import('./knowledge.js')
    invoke.mockResolvedValueOnce([{ id: 'spc_x', name: 'A', createdAt: 1, updatedAt: 1 }])
    const spaces = await knowledgeListSpaces()
    expect(spaces).toHaveLength(1)
    expect(invoke).toHaveBeenCalledWith('knowledge_list_spaces')
  })

  it('knowledgeCreateSpace wraps args', async () => {
    const { knowledgeCreateSpace } = await import('./knowledge.js')
    invoke.mockResolvedValueOnce({ id: 'spc_y', name: 'B', createdAt: 1, updatedAt: 1 })
    await knowledgeCreateSpace('B', '📦')
    expect(invoke).toHaveBeenCalledWith('knowledge_create_space', {
      args: { name: 'B', icon: '📦' },
    })
  })

  it('knowledgeErrorMessage normalizes', async () => {
    const { knowledgeErrorMessage } = await import('./knowledge.js')
    expect(knowledgeErrorMessage(new Error('x'))).toBe('x')
    expect(knowledgeErrorMessage('y')).toBe('y')
  })
})
