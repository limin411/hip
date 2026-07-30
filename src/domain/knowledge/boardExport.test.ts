/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest'
import {
  boardExportBounds,
  buildBoardExportSvg,
  escapeXml,
  fitImageSize,
  BOARD_EXPORT_EMPTY_SIZE,
  BOARD_EXPORT_PADDING,
  BOARD_IMAGE_MAX_EDGE,
} from './boardExport'
import type { HipBoardElement } from './boardScene'

const RECT: HipBoardElement = {
  id: 'r1',
  type: 'rect',
  x: 10,
  y: 20,
  w: 80,
  h: 40,
  fill: '#ffffff',
  stroke: '#111111',
  strokeWidth: 2,
  cornerRadius: 4,
}

const ELLIPSE: HipBoardElement = {
  id: 'e1',
  type: 'ellipse',
  x: 0,
  y: 0,
  w: 100,
  h: 50,
  fill: '#f00',
  stroke: '#000',
  strokeWidth: 1,
}

const LINE: HipBoardElement = {
  id: 'l1',
  type: 'line',
  x: 0,
  y: 0,
  x2: 30,
  y2: 40,
  stroke: '#111',
  strokeWidth: 2,
}

const ARROW: HipBoardElement = {
  id: 'a1',
  type: 'arrow',
  x: 0,
  y: 0,
  x2: 50,
  y2: 0,
  stroke: '#222',
  strokeWidth: 2,
}

const TEXT: HipBoardElement = {
  id: 't1',
  type: 'text',
  x: 5,
  y: 5,
  w: 160,
  h: 40,
  text: 'hello\nworld',
  fill: '#111',
  fontSize: 16,
}

const IMAGE: HipBoardElement = {
  id: 'img1',
  type: 'image',
  x: 0,
  y: 0,
  w: 64,
  h: 48,
  fileId: 'file_a',
}

describe('escapeXml', () => {
  it('escapes special characters', () => {
    expect(escapeXml(`a&b<c>"d"'e`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;&apos;e')
  })
})

describe('fitImageSize', () => {
  it('keeps size under max edge', () => {
    expect(fitImageSize(800, 600)).toEqual({ w: 800, h: 600 })
  })

  it('scales down so max edge equals cap', () => {
    const { w, h } = fitImageSize(4096, 2048)
    expect(Math.max(w, h)).toBe(BOARD_IMAGE_MAX_EDGE)
    expect(w / h).toBeCloseTo(2, 2)
  })
})

describe('boardExportBounds', () => {
  it('returns empty default when no elements', () => {
    expect(boardExportBounds([])).toEqual({
      x: 0,
      y: 0,
      w: BOARD_EXPORT_EMPTY_SIZE,
      h: BOARD_EXPORT_EMPTY_SIZE,
    })
  })

  it('unions element AABBs', () => {
    const b = boardExportBounds([RECT, ELLIPSE])
    // RECT: 10..90 × 20..60; ELLIPSE: 0..100 × 0..50 → union 0..100 × 0..60
    expect(b.x).toBe(0)
    expect(b.y).toBe(0)
    expect(b.w).toBe(100)
    expect(b.h).toBe(60)
  })
})

describe('buildBoardExportSvg', () => {
  it('includes background, shapes, and padding; no camera transform', () => {
    const { svg, width, height, bounds } = buildBoardExportSvg([RECT], {
      viewBackgroundColor: '#abcdef',
    })
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('fill="#abcdef"')
    expect(svg).toContain('<rect x="10" y="20"')
    expect(svg).not.toContain('data-element-type')
    expect(svg).not.toContain('translate(')
    expect(svg).not.toContain('scale(')
    expect(bounds.w).toBe(RECT.w + BOARD_EXPORT_PADDING * 2)
    expect(width).toBe(bounds.w)
    expect(height).toBe(bounds.h)
  })

  it('renders text with tspan per explicit newline', () => {
    const { svg } = buildBoardExportSvg([TEXT])
    expect(svg).toContain('<tspan')
    expect(svg).toContain('hello')
    expect(svg).toContain('world')
  })

  it('renders line and arrow with head polygon', () => {
    const { svg } = buildBoardExportSvg([LINE, ARROW])
    expect(svg).toContain('<line')
    expect(svg).toContain('<polygon')
  })

  it('inlines image dataURL and never uses blob:', () => {
    const dataURL = 'data:image/png;base64,AAAA'
    const { svg } = buildBoardExportSvg([IMAGE], {
      imageSrc: { file_a: { dataURL } },
    })
    expect(svg).toContain(`href="${dataURL}"`)
    expect(svg).not.toContain('blob:')
  })

  it('placeholder rect when image src missing', () => {
    const { svg } = buildBoardExportSvg([IMAGE], { imageSrc: {} })
    expect(svg).toContain('fill="#e5e5e5"')
    expect(svg).not.toContain('<image')
  })

  it('escapes text content', () => {
    const el: HipBoardElement = {
      ...TEXT,
      text: '<script>&',
    }
    const { svg } = buildBoardExportSvg([el])
    expect(svg).toContain('&lt;script&gt;&amp;')
    expect(svg).not.toContain('<script>')
  })
})
