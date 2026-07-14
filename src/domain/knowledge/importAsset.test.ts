import { describe, it, expect, vi, beforeEach } from 'vitest'

const knowledgeImportAssetFromPath = vi.fn()
const knowledgeImportAssetBytes = vi.fn()

vi.mock('@/ipc/knowledge', () => ({
  knowledgeImportAssetFromPath: (...a: unknown[]) => knowledgeImportAssetFromPath(...a),
  knowledgeImportAssetBytes: (...a: unknown[]) => knowledgeImportAssetBytes(...a),
}))

import { importAssetFromFile, isAbsoluteFsPath } from './importAsset'

beforeEach(() => {
  knowledgeImportAssetFromPath.mockReset()
  knowledgeImportAssetBytes.mockReset()
})

describe('isAbsoluteFsPath', () => {
  it('accepts Unix absolute paths', () => {
    expect(isAbsoluteFsPath('/tmp/a.png')).toBe(true)
    expect(isAbsoluteFsPath('/Users/me/pic.jpg')).toBe(true)
  })

  it('accepts Windows drive and UNC paths', () => {
    expect(isAbsoluteFsPath('C:\\Users\\me\\a.png')).toBe(true)
    expect(isAbsoluteFsPath('c:/Users/me/a.png')).toBe(true)
    expect(isAbsoluteFsPath('D:\\x\\y.webp')).toBe(true)
    expect(isAbsoluteFsPath('\\\\server\\share\\a.png')).toBe(true)
    expect(isAbsoluteFsPath('//server/share/a.png')).toBe(true)
  })

  it('rejects relative paths', () => {
    expect(isAbsoluteFsPath('a.png')).toBe(false)
    expect(isAbsoluteFsPath('./a.png')).toBe(false)
    expect(isAbsoluteFsPath('assets/a.png')).toBe(false)
    expect(isAbsoluteFsPath('')).toBe(false)
  })
})

describe('importAssetFromFile path gate', () => {
  it('uses path import for Windows absolute File.path', async () => {
    knowledgeImportAssetFromPath.mockResolvedValueOnce({
      relPath: 'assets/ast_x_a.png',
      mime: 'image/png',
      byteLength: 100,
    })
    const file = {
      name: 'a.png',
      type: 'image/png',
      size: 100,
      path: 'C:\\Users\\me\\a.png',
    } as File & { path: string }

    const result = await importAssetFromFile('spc_1', file)
    expect(result.ok).toBe(true)
    expect(knowledgeImportAssetFromPath).toHaveBeenCalledWith('spc_1', 'C:\\Users\\me\\a.png')
    expect(knowledgeImportAssetBytes).not.toHaveBeenCalled()
  })

  it('uses path import for Unix absolute File.path', async () => {
    knowledgeImportAssetFromPath.mockResolvedValueOnce({
      relPath: 'assets/ast_x_a.png',
      mime: 'image/png',
      byteLength: 10,
    })
    const file = {
      name: 'a.png',
      type: 'image/png',
      size: 10,
      path: '/tmp/a.png',
    } as File & { path: string }

    await importAssetFromFile('spc_1', file)
    expect(knowledgeImportAssetFromPath).toHaveBeenCalledWith('spc_1', '/tmp/a.png')
  })
})
