/**
 * Hip whiteboard PNG export pipeline (LKD-15 / PR-5).
 *
 * serialize SVG (world identity, images as inline dataURL) → Image → canvas.toBlob.
 * No camera pan/zoom in export. Zero new dependencies.
 */
import type { HipBoardElement } from './boardScene'
import {
  BOARD_TEXT_PADDING,
  arrowHeadPoints,
  elementAabb,
  textLineHeight,
  type WorldAabb,
} from './boardOps'

export const BOARD_EXPORT_PADDING = 16
export const BOARD_EXPORT_EMPTY_SIZE = 100
/** Cap devicePixelRatio for export canvas. */
export const BOARD_EXPORT_DPR_CAP = 2
/** Max edge (px) for newly placed board images. */
export const BOARD_IMAGE_MAX_EDGE = 2048

const TEXT_FONT_FAMILY = 'ui-sans-serif, system-ui, sans-serif'

export type BoardExportImageSrc = {
  /** Must be a data: URL for export SVG (never blob:). */
  dataURL: string
}

/** Escape text for SVG element content / attributes. */
export function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Union of element AABBs. Empty elements → 100×100 origin box.
 */
export function boardExportBounds(elements: readonly HipBoardElement[]): WorldAabb {
  if (elements.length === 0) {
    return { x: 0, y: 0, w: BOARD_EXPORT_EMPTY_SIZE, h: BOARD_EXPORT_EMPTY_SIZE }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const el of elements) {
    const b = elementAabb(el)
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, w: BOARD_EXPORT_EMPTY_SIZE, h: BOARD_EXPORT_EMPTY_SIZE }
  }
  const w = Math.max(1, maxX - minX)
  const h = Math.max(1, maxY - minY)
  return { x: minX, y: minY, w, h }
}

/** Scale natural image size so longest edge ≤ maxEdge; keep aspect. */
export function fitImageSize(
  naturalW: number,
  naturalH: number,
  maxEdge = BOARD_IMAGE_MAX_EDGE,
): { w: number; h: number } {
  const nw = Math.max(1, naturalW || 1)
  const nh = Math.max(1, naturalH || 1)
  const edge = Math.max(nw, nh)
  if (edge <= maxEdge) return { w: nw, h: nh }
  const s = maxEdge / edge
  return { w: Math.max(1, Math.round(nw * s)), h: Math.max(1, Math.round(nh * s)) }
}

function elementToSvg(
  el: HipBoardElement,
  imageSrc: ReadonlyMap<string, BoardExportImageSrc> | Record<string, BoardExportImageSrc>,
): string {
  const srcMap =
    imageSrc instanceof Map ? imageSrc : new Map(Object.entries(imageSrc))

  switch (el.type) {
    case 'rect': {
      const rx = el.cornerRadius || 0
      return `<rect x="${el.x}" y="${el.y}" width="${Math.max(0, el.w)}" height="${Math.max(0, el.h)}" fill="${escapeXml(el.fill)}" stroke="${escapeXml(el.stroke)}" stroke-width="${el.strokeWidth}" rx="${rx}" ry="${rx}"/>`
    }
    case 'ellipse': {
      const cx = el.x + el.w / 2
      const cy = el.y + el.h / 2
      const rx = Math.abs(el.w) / 2
      const ry = Math.abs(el.h) / 2
      return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${escapeXml(el.fill)}" stroke="${escapeXml(el.stroke)}" stroke-width="${el.strokeWidth}"/>`
    }
    case 'line':
      return `<line x1="${el.x}" y1="${el.y}" x2="${el.x2}" y2="${el.y2}" stroke="${escapeXml(el.stroke)}" stroke-width="${el.strokeWidth}"/>`
    case 'arrow': {
      const head = arrowHeadPoints(el.x, el.y, el.x2, el.y2, el.strokeWidth)
      return `<g><line x1="${el.x}" y1="${el.y}" x2="${el.x2}" y2="${el.y2}" stroke="${escapeXml(el.stroke)}" stroke-width="${el.strokeWidth}"/><polygon points="${head}" fill="${escapeXml(el.stroke)}" stroke="none"/></g>`
    }
    case 'text': {
      const lineHeight = textLineHeight(el.fontSize)
      const lines = el.text.split('\n')
      const x = el.x + BOARD_TEXT_PADDING
      const y0 = el.y + BOARD_TEXT_PADDING + lineHeight * 0.8
      const tspans = lines
        .map((line, i) => {
          const dy = i === 0 ? 0 : lineHeight
          const content = escapeXml(line.length === 0 ? ' ' : line)
          return `<tspan x="${x}" dy="${dy}">${content}</tspan>`
        })
        .join('')
      return `<text x="${x}" y="${y0}" fill="${escapeXml(el.fill)}" font-size="${el.fontSize}" font-family="${escapeXml(TEXT_FONT_FAMILY)}">${tspans}</text>`
    }
    case 'image': {
      const src = srcMap.get(el.fileId)
      if (!src?.dataURL || !src.dataURL.startsWith('data:')) {
        // Placeholder when missing (export still succeeds for other elements).
        return `<rect x="${el.x}" y="${el.y}" width="${Math.max(0, el.w)}" height="${Math.max(0, el.h)}" fill="#e5e5e5" stroke="#999" stroke-width="1"/>`
      }
      // href must not use blob:; data URLs only.
      return `<image x="${el.x}" y="${el.y}" width="${Math.max(0, el.w)}" height="${Math.max(0, el.h)}" href="${escapeXml(src.dataURL)}" preserveAspectRatio="none"/>`
    }
    default:
      return ''
  }
}

/**
 * Build export SVG string (world identity; no camera).
 * Images use inline dataURL href only.
 */
export function buildBoardExportSvg(
  elements: readonly HipBoardElement[],
  opts?: {
    viewBackgroundColor?: string
    imageSrc?: ReadonlyMap<string, BoardExportImageSrc> | Record<string, BoardExportImageSrc>
    padding?: number
  },
): { svg: string; width: number; height: number; bounds: WorldAabb } {
  const padding = opts?.padding ?? BOARD_EXPORT_PADDING
  const bg = opts?.viewBackgroundColor ?? '#ffffff'
  const imageSrc = opts?.imageSrc ?? new Map()
  const content = boardExportBounds(elements)
  const bounds: WorldAabb = {
    x: content.x - padding,
    y: content.y - padding,
    w: content.w + padding * 2,
    h: content.h + padding * 2,
  }
  const body = elements.map((el) => elementToSvg(el, imageSrc)).join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.w}" height="${bounds.h}" viewBox="${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}">` +
    `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}" fill="${escapeXml(bg)}"/>` +
    body +
    `</svg>`
  return { svg, width: bounds.w, height: bounds.h, bounds }
}

/**
 * Rasterize an SVG string to a PNG Blob via Image + canvas.
 * Returns null on failure (Workspace toasts).
 */
export async function svgStringToPngBlob(
  svg: string,
  width: number,
  height: number,
  opts?: { scale?: number },
): Promise<Blob | null> {
  const dpr =
    typeof opts?.scale === 'number' && Number.isFinite(opts.scale)
      ? opts.scale
      : typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
        ? Math.min(BOARD_EXPORT_DPR_CAP, Math.max(1, window.devicePixelRatio))
        : 1
  const w = Math.max(1, Math.ceil(width * dpr))
  const h = Math.max(1, Math.ceil(height * dpr))

  try {
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const objectUrl = URL.createObjectURL(svgBlob)
    try {
      const img = await loadHtmlImage(objectUrl)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.drawImage(img, 0, 0, width, height)
      const blob = await canvasToBlob(canvas, 'image/png')
      return blob
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  } catch {
    return null
  }
}

/**
 * Full exportPngBlob pipeline from elements + image dataURLs.
 */
export async function exportBoardPngBlob(
  elements: readonly HipBoardElement[],
  opts?: {
    viewBackgroundColor?: string
    imageSrc?: ReadonlyMap<string, BoardExportImageSrc> | Record<string, BoardExportImageSrc>
    padding?: number
    scale?: number
  },
): Promise<Blob | null> {
  const { svg, width, height } = buildBoardExportSvg(elements, opts)
  return svgStringToPngBlob(svg, width, height, { scale: opts?.scale })
}

function loadHtmlImage(src: string, timeoutMs = 8000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const timer = setTimeout(() => reject(new Error('image decode timeout')), timeoutMs)
    img.onload = () => {
      clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      clearTimeout(timer)
      reject(new Error('image decode failed'))
    }
    img.src = src
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((b) => resolve(b), type)
      return
    }
    // Fallback for environments without toBlob
    try {
      const dataUrl = canvas.toDataURL(type)
      const i = dataUrl.indexOf(',')
      const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j)
      resolve(new Blob([bytes], { type }))
    } catch {
      resolve(null)
    }
  })
}

/** Convert a data: URL to a Blob + object URL (prefer blob: for display). */
export function dataUrlToBlobUrl(dataURL: string): {
  url: string
  revoke: () => void
  mimeType: string
} {
  const mimeMatch = /^data:([^;,]+)/.exec(dataURL)
  const mimeType = mimeMatch?.[1] || 'image/png'
  const comma = dataURL.indexOf(',')
  const b64 = comma >= 0 ? dataURL.slice(comma + 1) : dataURL
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const blob = new Blob([bytes], { type: mimeType })
  const url = URL.createObjectURL(blob)
  return {
    url,
    mimeType,
    revoke: () => {
      URL.revokeObjectURL(url)
    },
  }
}

/** Read File/Blob as data URL. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('expected data URL'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

/** Decode natural size from an image URL (blob: or data:). Times out in test/headless. */
export function decodeImageNaturalSize(
  url: string,
  timeoutMs = 2500,
): Promise<{ naturalW: number; naturalH: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const timer = setTimeout(() => {
      reject(new Error('image decode timeout'))
    }, timeoutMs)
    img.onload = () => {
      clearTimeout(timer)
      resolve({
        naturalW: img.naturalWidth || 1,
        naturalH: img.naturalHeight || 1,
      })
    }
    img.onerror = () => {
      clearTimeout(timer)
      reject(new Error('image decode failed'))
    }
    img.src = url
  })
}

/**
 * Resolve a display URL (blob: or data:) to a data: URL for PNG export.
 * Never leaves blob: in export SVG.
 */
export async function resolveDataUrlForExport(
  url: string,
  cachedDataUrl?: string,
): Promise<string | null> {
  if (cachedDataUrl && cachedDataUrl.startsWith('data:')) return cachedDataUrl
  if (url.startsWith('data:')) return url
  if (!url.startsWith('blob:')) return null
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    return await blobToDataUrl(blob)
  } catch {
    return null
  }
}
