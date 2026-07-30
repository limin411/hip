import { describe, expect, it } from 'vitest'
import {
  BOARD_OUTLINE_MAX_ITEMS,
  boardOutlineSignature,
  buildSelectionSnapshot,
  buildSelectionStyleSnapshot,
  extractBoardOutline,
  outlineLabelForElement,
  selectionIdsSignature,
  selectionPublishSignature,
} from './boardOutline'
import type { HipBoardElement } from './boardScene'

const sample: HipBoardElement[] = [
  {
    id: 'r1',
    type: 'rect',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    fill: '#fff',
    stroke: '#111',
    strokeWidth: 2,
    cornerRadius: 0,
  },
  {
    id: 't1',
    type: 'text',
    x: 0,
    y: 0,
    w: 100,
    h: 20,
    text: 'Hello board',
    fill: '#111',
    fontSize: 16,
  },
  {
    id: 'img1',
    type: 'image',
    x: 0,
    y: 0,
    w: 50,
    h: 50,
    fileId: 'f1',
  },
]

describe('boardOutline signatures', () => {
  it('selectionIdsSignature sorts ids', () => {
    expect(selectionIdsSignature(['b', 'a'])).toBe(selectionIdsSignature(['a', 'b']))
  })

  it('selectionPublishSignature includes style', () => {
    const a = selectionPublishSignature(['a'], { fill: '#fff' })
    const b = selectionPublishSignature(['a'], { fill: '#000' })
    expect(a).not.toBe(b)
  })

  it('boardOutlineSignature changes when text label changes', () => {
    const s1 = boardOutlineSignature(sample)
    const textEl = sample[1]!
    if (textEl.type !== 'text') throw new Error('expected text')
    const s2 = boardOutlineSignature([
      sample[0]!,
      { ...textEl, text: 'Changed' },
      sample[2]!,
    ])
    expect(s1).not.toBe(s2)
  })
})

describe('extractBoardOutline', () => {
  it('labels text from content and shapes as type+shortId', () => {
    const out = extractBoardOutline('brd_1', sample)
    expect(out.boardId).toBe('brd_1')
    expect(out.totalElements).toBe(3)
    expect(out.imageCount).toBe(1)
    expect(out.truncated).toBe(false)
    expect(out.items[1]?.label).toBe('Hello board')
    expect(out.items[0]?.label).toMatch(/^rect /)
  })

  it('truncates at maxItems', () => {
    const many: HipBoardElement[] = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`,
      type: 'rect' as const,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      fill: '#fff',
      stroke: '#000',
      strokeWidth: 1,
      cornerRadius: 0,
    }))
    const out = extractBoardOutline('brd_1', many, { maxItems: 2 })
    expect(out.items).toHaveLength(2)
    expect(out.truncated).toBe(true)
    expect(out.totalElements).toBe(5)
  })

  it('BOARD_OUTLINE_MAX_ITEMS is 2000', () => {
    expect(BOARD_OUTLINE_MAX_ITEMS).toBe(2000)
  })
})

describe('selection style snapshot', () => {
  it('single-select full fields; multi mixed flags', () => {
    const els: HipBoardElement[] = [
      {
        id: 'a',
        type: 'rect',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        fill: '#fff',
        stroke: '#111',
        strokeWidth: 2,
        cornerRadius: 0,
      },
      {
        id: 'b',
        type: 'rect',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        fill: '#000',
        stroke: '#111',
        strokeWidth: 2,
        cornerRadius: 0,
      },
    ]
    const single = buildSelectionStyleSnapshot(els, ['a'])
    expect(single.fill).toBe('#fff')
    expect(single.mixed).toBeUndefined()

    const multi = buildSelectionStyleSnapshot(els, ['a', 'b'])
    expect(multi.mixed?.fill).toBe(true)
    expect(multi.stroke).toBe('#111')
    expect(multi.mixed?.stroke).toBeUndefined()
  })

  it('buildSelectionSnapshot sorts ids and attaches items', () => {
    const snap = buildSelectionSnapshot('brd_x', sample, ['t1', 'r1'])
    expect(snap.ids).toEqual(['r1', 't1'])
    expect(snap.items).toHaveLength(2)
    expect(snap.style.text).toBe('Hello board')
  })
})

describe('outlineLabelForElement', () => {
  it('uses type shortId for empty text', () => {
    const el: HipBoardElement = {
      id: 'abcdefghij',
      type: 'text',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      text: '   ',
      fill: '#0',
      fontSize: 12,
    }
    expect(outlineLabelForElement(el)).toBe('text abcdefgh')
  })
})
