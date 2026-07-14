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

  it('knowledgeListTemplates wraps spaceId', async () => {
    const { knowledgeListTemplates } = await import('./knowledge.js')
    invoke.mockResolvedValueOnce([])
    await knowledgeListTemplates('spc_a')
    expect(invoke).toHaveBeenCalledWith('knowledge_list_templates', {
      args: { spaceId: 'spc_a' },
    })
  })

  it('knowledgeSaveTemplate wraps create args', async () => {
    const { knowledgeSaveTemplate } = await import('./knowledge.js')
    invoke.mockResolvedValueOnce({
      id: 'tpl_x',
      name: 'M',
      body: '# hi',
      createdAt: 1,
      updatedAt: 1,
    })
    await knowledgeSaveTemplate('spc_a', { name: 'M', body: '# hi' })
    expect(invoke).toHaveBeenCalledWith('knowledge_save_template', {
      args: { spaceId: 'spc_a', id: undefined, name: 'M', body: '# hi' },
    })
  })

  it('knowledgeDeleteTemplate wraps ids', async () => {
    const { knowledgeDeleteTemplate } = await import('./knowledge.js')
    invoke.mockResolvedValueOnce(undefined)
    await knowledgeDeleteTemplate('spc_a', 'tpl_x')
    expect(invoke).toHaveBeenCalledWith('knowledge_delete_template', {
      args: { spaceId: 'spc_a', id: 'tpl_x' },
    })
  })
})
