import { describe, expect, it, vi } from 'vitest'
import {
  EMPTY_BOARD_SCENE,
  EMPTY_BOARD_SCENE_JSON,
  KNOWLEDGE_BOARD_MAX_BYTES,
  assertNoDataUrlInBoardJson,
  buildDiskScene,
  dataUrlToBase64,
  estimateDataUrlBytes,
  hydrateBoardFiles,
  importBoardFileBytes,
  parseBoardScene,
  pickPersistAppState,
  stableSerializeBoard,
  stripImageElementsForFiles,
  type HipBoardSceneDisk,
} from './boardScene'

describe('boardScene EMPTY', () => {
  it('EMPTY_BOARD_SCENE_JSON is valid dehydrated hip scene', () => {
    const scene = parseBoardScene(EMPTY_BOARD_SCENE_JSON)
    expect(scene.type).toBe('excalidraw')
    expect(scene.version).toBe(2)
    expect(scene.source).toBe('hip')
    expect(scene.hip?.schemaVersion).toBe(1)
    expect(scene.elements).toEqual([])
    expect(scene.files).toEqual({})
    expect(scene.appState.viewBackgroundColor).toBe('#ffffff')
    expect(() => assertNoDataUrlInBoardJson(EMPTY_BOARD_SCENE_JSON)).not.toThrow()
  })

  it('EMPTY_BOARD_SCENE serializes to EMPTY_BOARD_SCENE_JSON', () => {
    expect(stableSerializeBoard(EMPTY_BOARD_SCENE)).toBe(EMPTY_BOARD_SCENE_JSON)
  })

  it('KNOWLEDGE_BOARD_MAX_BYTES is 25MB', () => {
    expect(KNOWLEDGE_BOARD_MAX_BYTES).toBe(25 * 1024 * 1024)
  })
})

describe('stableSerializeBoard', () => {
  it('is stable across key insertion order for files', () => {
    const a: HipBoardSceneDisk = {
      type: 'excalidraw',
      version: 2,
      source: 'hip',
      hip: { schemaVersion: 1, boardId: 'brd_aaaaaaaaaaaa' },
      elements: [{ id: 'e1', type: 'rectangle' }],
      appState: { viewBackgroundColor: '#fff' },
      files: {
        z_file: {
          id: 'z_file',
          mimeType: 'image/png',
          created: 1,
          hipAssetRel: 'assets/ast_z.png',
        },
        a_file: {
          id: 'a_file',
          mimeType: 'image/png',
          created: 2,
          hipAssetRel: 'assets/ast_a.png',
        },
      },
    }
    const b: HipBoardSceneDisk = {
      ...a,
      files: {
        a_file: a.files.a_file,
        z_file: a.files.z_file,
      },
    }
    expect(stableSerializeBoard(a)).toBe(stableSerializeBoard(b))
  })

  it('round-trips through parseBoardScene', () => {
    const raw = stableSerializeBoard({
      type: 'excalidraw',
      version: 2,
      source: 'hip',
      elements: [{ text: 'hello dataURL word' }],
      appState: { viewBackgroundColor: '#ffffff', gridSize: null },
      files: {
        f1: {
          id: 'f1',
          mimeType: 'image/png',
          created: 99,
          hipAssetRel: 'assets/ast_x.png',
        },
      },
    })
    const parsed = parseBoardScene(raw)
    expect(parsed.files.f1.hipAssetRel).toBe('assets/ast_x.png')
    expect((parsed.elements[0] as { text: string }).text).toContain('dataURL')
  })
})

describe('assertNoDataUrlInBoardJson (field-level)', () => {
  it('allows element text containing the substring dataURL', () => {
    const raw = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'hip',
      elements: [{ type: 'text', text: 'mentions dataURL in label' }],
      appState: {},
      files: {},
    })
    expect(() => assertNoDataUrlInBoardJson(raw)).not.toThrow()
  })

  it('rejects files.x.dataURL', () => {
    const raw = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'hip',
      elements: [],
      appState: {},
      files: {
        x: {
          id: 'x',
          mimeType: 'image/png',
          created: 1,
          dataURL: 'data:image/png;base64,aaa',
        },
      },
    })
    expect(() => assertNoDataUrlInBoardJson(raw)).toThrow(/board file x must not contain dataURL/)
  })

  it('allows files.x.hipAssetRel only', () => {
    const raw = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'hip',
      elements: [],
      appState: {},
      files: {
        x: {
          id: 'x',
          mimeType: 'image/png',
          created: 1,
          hipAssetRel: 'assets/ast_x.png',
        },
      },
    })
    expect(() => assertNoDataUrlInBoardJson(raw)).not.toThrow()
  })

  it('allows missing or empty files', () => {
    expect(() => assertNoDataUrlInBoardJson('{"elements":[]}')).not.toThrow()
    expect(() => assertNoDataUrlInBoardJson('{"files":{}}')).not.toThrow()
  })
})

describe('parseBoardScene', () => {
  it('throws on non-object JSON', () => {
    expect(() => parseBoardScene('[]')).toThrow(/expected object/)
    expect(() => parseBoardScene('"str"')).toThrow(/expected object/)
  })

  it('throws when type is not excalidraw', () => {
    expect(() => parseBoardScene('{"type":"other"}')).toThrow(/excalidraw/)
  })
})

describe('pickPersistAppState / buildDiskScene (dehydrate)', () => {
  it('whitelists appState fields and drops collaborators/selection', () => {
    const picked = pickPersistAppState({
      viewBackgroundColor: '#abc',
      gridSize: 20,
      collaborators: new Map(),
      selectedElementIds: { a: true },
      openMenu: 'canvas',
      scrollX: 10,
      scrollY: 20,
      zoom: { value: 1 },
    })
    expect(picked).toEqual({
      viewBackgroundColor: '#abc',
      gridSize: 20,
      scrollX: 10,
      scrollY: 20,
      zoom: { value: 1 },
    })
    expect(picked).not.toHaveProperty('collaborators')
    expect(picked).not.toHaveProperty('selectedElementIds')
  })

  it('buildDiskScene only includes completed rels — never dataURL', () => {
    const rel = new Map([['f1', 'assets/ast_1.png']])
    const scene = buildDiskScene({
      elements: [
        { id: 'e1', type: 'rectangle' },
        { id: 'e2', type: 'image', fileId: 'f1' },
        { id: 'e3', type: 'image', fileId: 'pending' },
      ],
      appState: { viewBackgroundColor: '#fff', selectedElementIds: { e1: true } },
      relByFileId: rel,
      runtimeFiles: {
        f1: {
          id: 'f1',
          mimeType: 'image/png',
          created: 42,
          dataURL: 'data:image/png;base64,AAA',
        },
        pending: {
          id: 'pending',
          mimeType: 'image/png',
          created: 1,
          dataURL: 'data:image/png;base64,BBB',
        },
      },
      boardId: 'brd_testboard01',
    })
    expect(scene.files.f1).toEqual({
      id: 'f1',
      mimeType: 'image/png',
      created: 42,
      hipAssetRel: 'assets/ast_1.png',
    })
    expect(scene.files.pending).toBeUndefined()
    const raw = stableSerializeBoard(scene)
    expect(() => assertNoDataUrlInBoardJson(raw)).not.toThrow()
    expect(raw).not.toContain('data:image')
    // elements may still reference pending fileId in the scene; files map has no dataURL
    expect(scene.elements).toHaveLength(3)
  })

  it('stableSerializeBoard after buildDiskScene is field-level clean', () => {
    const scene = buildDiskScene({
      elements: [{ text: 'mentions dataURL literally' }],
      appState: {},
      relByFileId: { x: 'assets/ast_x.png' },
      boardId: 'brd_aaaaaaaaaaaa',
    })
    const raw = stableSerializeBoard(scene)
    expect(() => assertNoDataUrlInBoardJson(raw)).not.toThrow()
    expect(JSON.parse(raw).files.x.dataURL).toBeUndefined()
  })
})

describe('stripImageElementsForFiles / dataURL helpers', () => {
  it('strips only image elements with matching fileIds', () => {
    const els = [
      { id: '1', type: 'rectangle' },
      { id: '2', type: 'image', fileId: 'a' },
      { id: '3', type: 'image', fileId: 'b' },
      { id: '4', type: 'text', text: 'hi' },
    ]
    const out = stripImageElementsForFiles(els, new Set(['a']))
    expect(out.map((e) => (e as { id: string }).id)).toEqual(['1', '3', '4'])
  })

  it('estimateDataUrlBytes and dataUrlToBase64', () => {
    // "AAAA" base64 → 3 bytes
    expect(estimateDataUrlBytes('data:image/png;base64,AAAA')).toBe(3)
    expect(dataUrlToBase64('data:image/png;base64,QUJD')).toBe('QUJD')
  })
})

describe('hydrateBoardFiles / importBoardFileBytes', () => {
  it('hydrates hipAssetRel via resolve and skips failures', async () => {
    const resolve = vi.fn(async (_space: string, rel: string) => {
      if (rel.endsWith('missing.png')) return null
      return { dataUrl: 'data:image/png;base64,QQ==', mime: 'image/png' }
    })
    const result = await hydrateBoardFiles(
      'spc_1',
      {
        ok: {
          id: 'ok',
          mimeType: 'image/png',
          created: 1,
          hipAssetRel: 'assets/ast_ok.png',
        },
        bad: {
          id: 'bad',
          mimeType: 'image/png',
          created: 2,
          hipAssetRel: 'assets/missing.png',
        },
      },
      { resolve },
    )
    expect(result.files.ok?.dataURL).toContain('data:image/png')
    expect(result.relByFileId.get('ok')).toBe('assets/ast_ok.png')
    expect(result.files.bad).toBeUndefined()
    expect(result.failedIds).toContain('bad')
  })

  it('importBoardFileBytes returns hipAssetRel and never embeds dataURL in map', async () => {
    const importBytes = vi.fn(async () => ({
      relPath: 'assets/ast_board.png',
      mime: 'image/png',
      byteLength: 12,
    }))
    const rel = await importBoardFileBytes(
      'spc_1',
      {
        id: 'file1',
        mimeType: 'image/png',
        created: 1,
        dataURL: 'data:image/png;base64,QUJD',
      },
      { importBytes },
    )
    expect(rel).toBe('assets/ast_board.png')
    expect(importBytes).toHaveBeenCalledWith(
      'spc_1',
      expect.objectContaining({
        base64: 'QUJD',
        mime: 'image/png',
        fileName: expect.stringContaining('board-file1'),
      }),
    )
  })
})
