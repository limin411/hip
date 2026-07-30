/**
 * Pure unit tests for whiteboard e2e disk helpers (no live Tauri app).
 * Live GUI smoke: e2e/specs/knowledge-board.spec.ts (requires yarn test:e2e).
 */
import { describe, expect, it } from 'vitest'
import {
  boardPrimaryFilename,
  boardLegacyFilename,
  preferBoardDiskPath,
  isHipBoardSceneBody,
} from '../helpers/knowledge.js'

describe('board disk path helpers (hip-board primary)', () => {
  it('boardPrimaryFilename uses .board.json', () => {
    expect(boardPrimaryFilename('brd_abc')).toBe('brd_abc.board.json')
  })

  it('boardLegacyFilename uses .excalidraw', () => {
    expect(boardLegacyFilename('brd_abc')).toBe('brd_abc.excalidraw')
  })

  it('preferBoardDiskPath picks primary over legacy', () => {
    expect(
      preferBoardDiskPath('/k/boards/brd_x.board.json', '/k/boards/brd_x.excalidraw'),
    ).toBe('/k/boards/brd_x.board.json')
  })

  it('preferBoardDiskPath falls back to legacy when primary missing', () => {
    expect(preferBoardDiskPath(null, '/k/boards/brd_x.excalidraw')).toBe(
      '/k/boards/brd_x.excalidraw',
    )
  })

  it('preferBoardDiskPath returns null when neither exists', () => {
    expect(preferBoardDiskPath(null, undefined)).toBeNull()
  })

  it('isHipBoardSceneBody accepts compact and spaced type field', () => {
    expect(isHipBoardSceneBody('{"type":"hip-board","version":1}')).toBe(true)
    expect(isHipBoardSceneBody('{ "type": "hip-board", "version": 1 }')).toBe(true)
    expect(isHipBoardSceneBody('{"type":"excalidraw"}')).toBe(false)
  })
})
