import { describe, expect, it } from 'vitest'
import {
  applyBoxResize,
  arrowHeadPoints,
  BOARD_HISTORY_MAX,
  BOARD_TEXT_PADDING,
  clampZoom,
  cloneHistoryEntry,
  deleteElements,
  elementAabb,
  hitTest,
  hitTestBoxHandle,
  hitTestLineEndpoint,
  hitTestMarquee,
  isTinyBox,
  isTinyLine,
  measureTextHeight,
  moveElements,
  moveLineEndpoint,
  normalizeRectFromDrag,
  pushHistory,
  resizeBoxFromHandle,
  screenToWorld,
  selectionUnionAabb,
  textLineHeight,
  worldGroupTransform,
  worldToScreen,
  zoomAtScreenPoint,
  type BoardHistoryEntry,
} from './boardOps'
import type { HipBoardElement } from './boardScene'
import { HIP_BOARD_ZOOM_MAX, HIP_BOARD_ZOOM_MIN } from './boardScene'

const rect = (
  partial: Partial<Extract<HipBoardElement, { type: 'rect' }>> & { id: string },
): Extract<HipBoardElement, { type: 'rect' }> => ({
  type: 'rect',
  x: 0,
  y: 0,
  w: 100,
  h: 50,
  fill: '#fff',
  stroke: '#111',
  strokeWidth: 2,
  cornerRadius: 0,
  ...partial,
})

describe('boardOps camera', () => {
  it('clamps zoom to 0.25..4', () => {
    expect(clampZoom(0.01)).toBe(HIP_BOARD_ZOOM_MIN)
    expect(clampZoom(99)).toBe(HIP_BOARD_ZOOM_MAX)
    expect(clampZoom(1)).toBe(1)
  })

  it('screenToWorld / worldToScreen invert', () => {
    const cam = { x: 40, y: -20, zoom: 2 }
    const w = screenToWorld(100, 50, cam)
    const s = worldToScreen(w.x, w.y, cam)
    expect(s.x).toBeCloseTo(100)
    expect(s.y).toBeCloseTo(50)
  })

  it('zoomAtScreenPoint keeps world under cursor fixed', () => {
    const cam = { x: 0, y: 0, zoom: 1 }
    const next = zoomAtScreenPoint(cam, 200, 100, 2)
    const before = screenToWorld(200, 100, cam)
    const after = screenToWorld(200, 100, next)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(next.zoom).toBe(2)
  })

  it('worldGroupTransform matches camera', () => {
    expect(worldGroupTransform({ x: 10, y: 20, zoom: 1.5 })).toBe(
      'translate(10,20) scale(1.5)',
    )
  })
})

describe('boardOps hit-test', () => {
  it('hits rect AABB; topmost wins', () => {
    const els: HipBoardElement[] = [
      rect({ id: 'bottom', x: 0, y: 0, w: 100, h: 100 }),
      rect({ id: 'top', x: 10, y: 10, w: 20, h: 20 }),
    ]
    expect(hitTest(els, 15, 15)).toBe('top')
    expect(hitTest(els, 90, 90)).toBe('bottom')
    expect(hitTest(els, 200, 200)).toBeNull()
  })

  it('hits ellipse via equation not only AABB', () => {
    const el: HipBoardElement = {
      id: 'e',
      type: 'ellipse',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      fill: '#fff',
      stroke: '#000',
      strokeWidth: 0,
    }
    // Corner of AABB is outside the ellipse
    expect(hitTest([el], 1, 1)).toBeNull()
    // Center is inside
    expect(hitTest([el], 50, 50)).toBe('e')
  })

  it('hits line within screen-stable slab', () => {
    const line: HipBoardElement = {
      id: 'l',
      type: 'line',
      x: 0,
      y: 0,
      x2: 100,
      y2: 0,
      stroke: '#000',
      strokeWidth: 2,
    }
    expect(hitTest([line], 50, 0, 1)).toBe('l')
    expect(hitTest([line], 50, 20, 1)).toBeNull()
  })

  it('marquee intersects AABB', () => {
    const els = [rect({ id: 'a', x: 0, y: 0, w: 10, h: 10 }), rect({ id: 'b', x: 50, y: 50, w: 10, h: 10 })]
    expect(hitTestMarquee(els, { x: -1, y: -1, w: 20, h: 20 })).toEqual(['a'])
  })

  it('marquee with inverted w/h (drag right→left) still hits', () => {
    const els = [rect({ id: 'a', x: 0, y: 0, w: 10, h: 10 })]
    // Drag from (15,15) to (-5,-5) → w/h negative
    expect(hitTestMarquee(els, { x: 15, y: 15, w: -20, h: -20 })).toEqual(['a'])
  })
})

describe('boardOps transforms', () => {
  it('moveElements skips locked and translates line endpoints', () => {
    const els: HipBoardElement[] = [
      rect({ id: 'a', x: 0, y: 0 }),
      { ...rect({ id: 'locked', x: 0, y: 0 }), locked: true },
      {
        id: 'ln',
        type: 'line',
        x: 0,
        y: 0,
        x2: 10,
        y2: 10,
        stroke: '#000',
        strokeWidth: 1,
      },
    ]
    const out = moveElements(els, new Set(['a', 'locked', 'ln']), 5, 3)
    expect((out[0] as { x: number }).x).toBe(5)
    expect((out[1] as { x: number }).x).toBe(0)
    expect(out[2]).toMatchObject({ x: 5, y: 3, x2: 15, y2: 13 })
  })

  it('deleteElements keeps locked', () => {
    const els = [
      rect({ id: 'a' }),
      { ...rect({ id: 'b' }), locked: true },
    ]
    const out = deleteElements(els, new Set(['a', 'b']))
    expect(out.map((e) => e.id)).toEqual(['b'])
  })

  it('elementAabb for line', () => {
    const box = elementAabb({
      id: 'l',
      type: 'arrow',
      x: 10,
      y: 20,
      x2: 0,
      y2: 0,
      stroke: '#0',
      strokeWidth: 1,
    })
    expect(box).toEqual({ x: 0, y: 0, w: 10, h: 20 })
  })

  it('arrowHeadPoints returns triangle at tip', () => {
    const pts = arrowHeadPoints(0, 0, 100, 0, 2)
    // Tip at (100,0); three vertices
    expect(pts.split(' ')).toHaveLength(3)
    expect(pts.startsWith('100,0')).toBe(true)
  })
})

describe('boardOps text contract', () => {
  it('measureTextHeight uses explicit \\n lines only', () => {
    const fontSize = 16
    const lh = textLineHeight(fontSize)
    // empty → 1 line
    expect(measureTextHeight('', fontSize)).toBe(BOARD_TEXT_PADDING * 2 + lh)
    expect(measureTextHeight('hello', fontSize)).toBe(BOARD_TEXT_PADDING * 2 + lh)
    expect(measureTextHeight('a\nb', fontSize)).toBe(BOARD_TEXT_PADDING * 2 + 2 * lh)
    expect(measureTextHeight('a\nb\nc', fontSize)).toBe(BOARD_TEXT_PADDING * 2 + 3 * lh)
    // trailing newline still counts as an extra line (split behavior)
    expect(measureTextHeight('a\n', fontSize)).toBe(BOARD_TEXT_PADDING * 2 + 2 * lh)
  })

  it('normalizeRectFromDrag handles inverted drag', () => {
    expect(normalizeRectFromDrag(10, 20, 0, 0)).toEqual({ x: 0, y: 0, w: 10, h: 20 })
  })

  it('isTinyBox / isTinyLine thresholds', () => {
    expect(isTinyBox(1, 1)).toBe(true)
    expect(isTinyBox(10, 0)).toBe(false)
    expect(isTinyLine(0, 0, 0.5, 0)).toBe(true)
    expect(isTinyLine(0, 0, 10, 0)).toBe(false)
  })
})

describe('boardOps resize + handles (PR-3)', () => {
  it('resizeBoxFromHandle se grows box; nw moves origin', () => {
    const origin = { x: 10, y: 20, w: 100, h: 50 }
    const se = resizeBoxFromHandle(origin, 'se', 150, 100)
    expect(se).toEqual({ x: 10, y: 20, w: 140, h: 80 })
    const nw = resizeBoxFromHandle(origin, 'nw', 0, 0)
    expect(nw).toEqual({ x: 0, y: 0, w: 110, h: 70 })
  })

  it('resizeBoxFromHandle enforces min size', () => {
    const origin = { x: 0, y: 0, w: 100, h: 100 }
    const tiny = resizeBoxFromHandle(origin, 'se', 1, 1, 2)
    expect(tiny.w).toBeGreaterThanOrEqual(2)
    expect(tiny.h).toBeGreaterThanOrEqual(2)
  })

  it('hitTestBoxHandle finds se corner', () => {
    const box = { x: 0, y: 0, w: 100, h: 50 }
    expect(hitTestBoxHandle(box, 100, 50, 1)).toBe('se')
    expect(hitTestBoxHandle(box, 50, 25, 1)).toBeNull()
  })

  it('applyBoxResize skips locked', () => {
    const el = { ...rect({ id: 'a', x: 0, y: 0, w: 10, h: 10 }), locked: true }
    const out = applyBoxResize(el, { x: 5, y: 5, w: 20, h: 20 })
    expect(out).toBe(el)
  })

  it('applyBoxResize updates rect geometry', () => {
    const el = rect({ id: 'a', x: 0, y: 0, w: 10, h: 10 })
    const out = applyBoxResize(el, { x: 1, y: 2, w: 30, h: 40 })
    expect(out).toMatchObject({ x: 1, y: 2, w: 30, h: 40 })
  })

  it('line endpoint move + hit', () => {
    const line: Extract<HipBoardElement, { type: 'line' | 'arrow' }> = {
      id: 'l',
      type: 'line',
      x: 0,
      y: 0,
      x2: 100,
      y2: 0,
      stroke: '#000',
      strokeWidth: 2,
    }
    expect(hitTestLineEndpoint(line, 0, 0, 1)).toBe('start')
    expect(hitTestLineEndpoint(line, 100, 0, 1)).toBe('end')
    expect(moveLineEndpoint(line, 'end', 50, 25)).toMatchObject({ x2: 50, y2: 25 })
    const locked = { ...line, locked: true }
    expect(moveLineEndpoint(locked, 'end', 1, 1)).toBe(locked)
  })

  it('selectionUnionAabb unions selected boxes', () => {
    const els = [
      rect({ id: 'a', x: 0, y: 0, w: 10, h: 10 }),
      rect({ id: 'b', x: 50, y: 50, w: 10, h: 10 }),
    ]
    expect(selectionUnionAabb(els, ['a', 'b'])).toEqual({ x: 0, y: 0, w: 60, h: 60 })
    expect(selectionUnionAabb(els, [])).toBeNull()
  })
})

describe('boardOps history ring (LKD-12)', () => {
  it('cloneHistoryEntry deep-enough clones elements and filesRel', () => {
    const els = [rect({ id: 'a' })]
    const files = { f1: 'assets/img.png' }
    const entry = cloneHistoryEntry(els, files)
    expect(entry.elements[0]).not.toBe(els[0])
    expect(entry.elements[0]).toEqual(els[0])
    expect(entry.filesRel).not.toBe(files)
    expect(entry.filesRel).toEqual(files)
  })

  it('pushHistory caps at BOARD_HISTORY_MAX and clears future', () => {
    const past: BoardHistoryEntry[] = []
    const future: BoardHistoryEntry[] = [
      cloneHistoryEntry([], { stale: 'x' }),
    ]
    for (let i = 0; i < BOARD_HISTORY_MAX + 5; i++) {
      pushHistory(past, future, cloneHistoryEntry([rect({ id: `r${i}` })], {}))
    }
    expect(past.length).toBe(BOARD_HISTORY_MAX)
    expect(past[0]!.elements[0]!.id).toBe('r5')
    expect(future).toHaveLength(0)
  })
})
