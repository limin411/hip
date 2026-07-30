import { describe, expect, it } from 'vitest'
import { migrateExcalidrawToHipBoard } from './boardMigrate'

describe('migrateExcalidrawToHipBoard', () => {
  it('maps rectangle, ellipse, text, line, arrow, image with hipAssetRel', () => {
    const { scene, skipped, unsupported, sourceHadElements } = migrateExcalidrawToHipBoard(
      {
        type: 'excalidraw',
        elements: [
          {
            id: 'r1',
            type: 'rectangle',
            x: 1,
            y: 2,
            width: 30,
            height: 40,
            backgroundColor: '#abc',
            strokeColor: '#def',
            strokeWidth: 3,
          },
          {
            id: 'e1',
            type: 'ellipse',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            backgroundColor: '#fff',
            strokeColor: '#000',
            strokeWidth: 1,
          },
          {
            id: 't1',
            type: 'text',
            x: 0,
            y: 0,
            width: 80,
            height: 20,
            text: 'hi',
            fontSize: 20,
            strokeColor: '#333',
          },
          {
            id: 'l1',
            type: 'line',
            x: 0,
            y: 0,
            points: [
              [0, 0],
              [50, 25],
            ],
            strokeColor: '#111',
            strokeWidth: 2,
          },
          {
            id: 'a1',
            type: 'arrow',
            x: 10,
            y: 10,
            points: [
              [0, 0],
              [20, 0],
            ],
            strokeColor: '#111',
            strokeWidth: 2,
          },
          {
            id: 'i1',
            type: 'image',
            x: 0,
            y: 0,
            width: 64,
            height: 64,
            fileId: 'f1',
          },
        ],
        files: {
          f1: {
            id: 'f1',
            mimeType: 'image/png',
            created: 1,
            hipAssetRel: 'assets/ast_f1.png',
          },
        },
        appState: { viewBackgroundColor: '#fafafa' },
      },
      { boardId: 'brd_mig01' },
    )

    expect(sourceHadElements).toBe(true)
    expect(unsupported).toBe(false)
    expect(skipped).toBe(0)
    expect(scene.type).toBe('hip-board')
    expect(scene.hip.boardId).toBe('brd_mig01')
    expect(scene.elements.map((e) => e.type)).toEqual([
      'rect',
      'ellipse',
      'text',
      'line',
      'arrow',
      'image',
    ])
    const text = scene.elements.find((e) => e.type === 'text')
    // fontSize 20 is equidistant 16/24; nearest picks lower on tie
    expect(text && text.type === 'text' && text.fontSize).toBe(16)
    expect(scene.files.f1?.hipAssetRel).toBe('assets/ast_f1.png')
    expect(scene.appState.viewBackgroundColor).toBe('#fafafa')
  })

  it('skips diamond/freedraw and counts skipped', () => {
    const { scene, skipped } = migrateExcalidrawToHipBoard({
      elements: [
        { id: 'd1', type: 'diamond', x: 0, y: 0, width: 10, height: 10 },
        { id: 'f1', type: 'freedraw', x: 0, y: 0, points: [] },
        {
          id: 'r1',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          backgroundColor: '#fff',
          strokeColor: '#000',
          strokeWidth: 1,
        },
      ],
    })
    expect(scene.elements).toHaveLength(1)
    expect(skipped).toBe(2)
  })

  it('omits isDeleted elements without counting as skipped', () => {
    const { scene, skipped } = migrateExcalidrawToHipBoard({
      elements: [
        {
          id: 'r1',
          type: 'rectangle',
          isDeleted: true,
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        },
      ],
    })
    expect(scene.elements).toHaveLength(0)
    expect(skipped).toBe(0)
  })

  it('unsupported when source had elements but zero migrated', () => {
    const { unsupported, sourceHadElements, scene } = migrateExcalidrawToHipBoard({
      elements: [{ id: 'd1', type: 'diamond', x: 0, y: 0, width: 1, height: 1 }],
    })
    expect(sourceHadElements).toBe(true)
    expect(unsupported).toBe(true)
    expect(scene.elements).toHaveLength(0)
  })

  it('empty source is not unsupported', () => {
    const { unsupported, sourceHadElements } = migrateExcalidrawToHipBoard({
      elements: [],
    })
    expect(sourceHadElements).toBe(false)
    expect(unsupported).toBe(false)
  })

  it('strips image without hipAssetRel file entry', () => {
    const { scene, skipped } = migrateExcalidrawToHipBoard({
      elements: [
        {
          id: 'i1',
          type: 'image',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          fileId: 'missing',
        },
      ],
      files: {},
    })
    expect(scene.elements).toHaveLength(0)
    expect(skipped).toBeGreaterThanOrEqual(1)
  })

  it('roundness on rectangle → cornerRadius 8', () => {
    const { scene } = migrateExcalidrawToHipBoard({
      elements: [
        {
          id: 'r1',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          roundness: { type: 3 },
          backgroundColor: '#fff',
          strokeColor: '#000',
          strokeWidth: 1,
        },
      ],
    })
    const r = scene.elements[0]
    expect(r && r.type === 'rect' && r.cornerRadius).toBe(8)
  })

  it('line/arrow first point offset is applied to start (not only end)', () => {
    const { scene } = migrateExcalidrawToHipBoard({
      elements: [
        {
          id: 'l1',
          type: 'line',
          x: 100,
          y: 100,
          points: [
            [10, 20],
            [50, 60],
          ],
          strokeColor: '#111',
          strokeWidth: 2,
        },
        {
          id: 'a1',
          type: 'arrow',
          x: 0,
          y: 0,
          points: [
            [5, 5],
            [25, 5],
          ],
          strokeColor: '#111',
          strokeWidth: 2,
        },
      ],
    })
    const line = scene.elements.find((e) => e.id === 'l1')
    expect(line).toMatchObject({ type: 'line', x: 110, y: 120, x2: 150, y2: 160 })
    const arrow = scene.elements.find((e) => e.id === 'a1')
    expect(arrow).toMatchObject({ type: 'arrow', x: 5, y: 5, x2: 25, y2: 5 })
  })
})
