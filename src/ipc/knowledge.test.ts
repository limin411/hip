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

  it('knowledgeSaveVersion wraps daily args', async () => {
    const { knowledgeSaveVersion } = await import('./knowledge.js')
    invoke.mockResolvedValueOnce({
      id: '2026-07-14T00-00-00-000',
      file: '2026-07-14T00-00-00-000.md',
      createdAt: 1,
      kind: 'daily',
      dayKey: '2026-07-14',
      byteLength: 3,
    })
    await knowledgeSaveVersion('spc_1', 'doc_1', 'daily', '2026-07-14')
    expect(invoke).toHaveBeenCalledWith('knowledge_save_version', {
      args: { spaceId: 'spc_1', docId: 'doc_1', kind: 'daily', dayKey: '2026-07-14' },
    })
  })

  it('knowledgeListVersions / restore wrap args', async () => {
    const { knowledgeListVersions, knowledgeRestoreVersion, knowledgeReadVersion } =
      await import('./knowledge.js')
    invoke.mockResolvedValueOnce([])
    await knowledgeListVersions('spc_1', 'doc_1')
    expect(invoke).toHaveBeenCalledWith('knowledge_list_versions', {
      args: { spaceId: 'spc_1', docId: 'doc_1' },
    })
    invoke.mockResolvedValueOnce('body')
    await knowledgeRestoreVersion('spc_1', 'doc_1', 'v1')
    expect(invoke).toHaveBeenCalledWith('knowledge_restore_version', {
      args: { spaceId: 'spc_1', docId: 'doc_1', versionId: 'v1' },
    })
    invoke.mockResolvedValueOnce('body')
    await knowledgeReadVersion('spc_1', 'doc_1', 'v1')
    expect(invoke).toHaveBeenCalledWith('knowledge_read_version', {
      args: { spaceId: 'spc_1', docId: 'doc_1', versionId: 'v1' },
    })
  })
})
