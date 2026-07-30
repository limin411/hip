import { describe, expect, it } from 'vitest'
import {
  EMPTY_BOARD_SCENE,
  EMPTY_BOARD_SCENE_JSON,
  KNOWLEDGE_BOARD_MAX_BYTES,
  assertNoDataUrlInBoardJson,
  parseBoardScene,
  stableSerializeBoard,
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
