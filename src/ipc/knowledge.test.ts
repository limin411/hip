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

  it('asset IPC wrappers pass camelCase args and never echo bytes on import', async () => {
    const {
      knowledgeImportAssetFromPath,
      knowledgeImportAssetBytes,
      knowledgeReadAssetData,
      knowledgeAssetAbsPath,
      knowledgeRevealPath,
    } = await import('./knowledge.js')

    invoke.mockResolvedValueOnce({
      relPath: 'assets/ast_x_a.png',
      mime: 'image/png',
      byteLength: 12,
    })
    const meta = await knowledgeImportAssetFromPath('spc_1', '/tmp/a.png')
    expect(meta.relPath).toBe('assets/ast_x_a.png')
    expect(invoke).toHaveBeenCalledWith('knowledge_import_asset_from_path', {
      args: { spaceId: 'spc_1', sourcePath: '/tmp/a.png' },
    })

    invoke.mockResolvedValueOnce({
      relPath: 'assets/ast_y_b.png',
      mime: 'image/png',
      byteLength: 4,
    })
    await knowledgeImportAssetBytes('spc_1', {
      base64: 'AAAA',
      fileName: 'b.png',
      mime: 'image/png',
    })
    expect(invoke).toHaveBeenCalledWith('knowledge_import_asset_bytes', {
      args: {
        spaceId: 'spc_1',
        base64: 'AAAA',
        fileName: 'b.png',
        mime: 'image/png',
      },
    })

    invoke.mockResolvedValueOnce({ mime: 'image/png', base64: 'xxxx' })
    await knowledgeReadAssetData('spc_1', 'assets/ast_x_a.png')
    expect(invoke).toHaveBeenCalledWith('knowledge_read_asset_data', {
      args: { spaceId: 'spc_1', relPath: 'assets/ast_x_a.png' },
    })

    invoke.mockResolvedValueOnce({ absolutePath: '/x/assets/a.png' })
    await knowledgeAssetAbsPath('spc_1', 'assets/a.png')
    invoke.mockResolvedValueOnce(undefined)
    await knowledgeRevealPath('spc_1', 'assets/a.png')
    expect(invoke).toHaveBeenCalledWith('knowledge_reveal_path', {
      args: { spaceId: 'spc_1', relPath: 'assets/a.png' },
  it('knowledgeListTemplates wraps spaceId', async () => {
    const { knowledgeListTemplates } = await import('./knowledge.js')
    invoke.mockResolvedValueOnce([])
    await knowledgeListTemplates('spc_a')
    expect(invoke).toHaveBeenCalledWith('knowledge_list_templates', {
      args: { spaceId: 'spc_a' },
  })
  it('knowledgeSaveTemplate wraps create args', async () => {
    const { knowledgeSaveTemplate } = await import('./knowledge.js')
      id: 'tpl_x',
      name: 'M',
      body: '# hi',
      createdAt: 1,
      updatedAt: 1,
    await knowledgeSaveTemplate('spc_a', { name: 'M', body: '# hi' })
    expect(invoke).toHaveBeenCalledWith('knowledge_save_template', {
      args: { spaceId: 'spc_a', id: undefined, name: 'M', body: '# hi' },
  })
  it('knowledgeDeleteTemplate wraps ids', async () => {
    const { knowledgeDeleteTemplate } = await import('./knowledge.js')
    await knowledgeDeleteTemplate('spc_a', 'tpl_x')
    expect(invoke).toHaveBeenCalledWith('knowledge_delete_template', {
      args: { spaceId: 'spc_a', id: 'tpl_x' },
    })
  })
})
