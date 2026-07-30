/**
 * Pure Excalidraw → hip-board migration (LKD-8 mapping table).
 * Wired on openDoc board path (PR-C); upgrade write + unsupported gate in knowledgeStore.
 */
import type {
  HipBoardElement,
  HipBoardFileOnDisk,
  HipBoardSceneDisk,
  HipBoardText,
} from './boardScene'

export type MigrateExcalidrawResult = {
  scene: HipBoardSceneDisk
  skipped: number
  /** True when source had elements but none migrated (unsupported). */
  unsupported: boolean
  sourceHadElements: boolean
}

function nearestFontSize(n: unknown): 12 | 16 | 24 {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 16
  const candidates: Array<12 | 16 | 24> = [12, 16, 24]
  let best: 12 | 16 | 24 = 16
  let bestDist = Infinity
  for (const c of candidates) {
    const d = Math.abs(c - v)
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  return best
}

function asNum(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function asStr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

function mapElement(raw: unknown): HipBoardElement | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.isDeleted === true) return null
  const id = typeof o.id === 'string' && o.id.length > 0 ? o.id : null
  if (!id) return null
  const type = o.type

  if (type === 'rectangle') {
    const roundness = o.roundness
    const cornerRadius =
      roundness && typeof roundness === 'object' ? 8 : 0
    return {
      id,
      type: 'rect',
      x: asNum(o.x),
      y: asNum(o.y),
      w: asNum(o.width, 100),
      h: asNum(o.height, 100),
      fill: asStr(o.backgroundColor, '#ffffff'),
      stroke: asStr(o.strokeColor, '#111111'),
      strokeWidth: asNum(o.strokeWidth, 2),
      cornerRadius,
      ...(o.locked === true ? { locked: true } : {}),
    }
  }

  if (type === 'ellipse') {
    return {
      id,
      type: 'ellipse',
      x: asNum(o.x),
      y: asNum(o.y),
      w: asNum(o.width, 100),
      h: asNum(o.height, 100),
      fill: asStr(o.backgroundColor, '#ffffff'),
      stroke: asStr(o.strokeColor, '#111111'),
      strokeWidth: asNum(o.strokeWidth, 2),
      ...(o.locked === true ? { locked: true } : {}),
    }
  }

  if (type === 'text') {
    const text: HipBoardText = {
      id,
      type: 'text',
      x: asNum(o.x),
      y: asNum(o.y),
      w: asNum(o.width, 160),
      h: asNum(o.height, 24),
      text: typeof o.text === 'string' ? o.text : '',
      fill: asStr(o.strokeColor, asStr(o.color, '#111111')),
      fontSize: nearestFontSize(o.fontSize),
      ...(o.locked === true ? { locked: true } : {}),
    }
    return text
  }

  if (type === 'line' || type === 'arrow') {
    // Multi-point → first/last in element-local coords offset by origin.
    let x = asNum(o.x)
    let y = asNum(o.y)
    let x2 = x + asNum(o.width, 0)
    let y2 = y + asNum(o.height, 0)
    const points = o.points
    if (Array.isArray(points) && points.length >= 2) {
      const first = points[0]
      const last = points[points.length - 1]
      if (Array.isArray(first) && Array.isArray(last)) {
        x = asNum(o.x) + asNum(first[0])
        y = asNum(o.y) + asNum(first[1])
        x2 = asNum(o.x) + asNum(last[0])
        y2 = asNum(o.y) + asNum(last[1])
      }
    }
    return {
      id,
      type: type === 'arrow' ? 'arrow' : 'line',
      x,
      y,
      x2,
      y2,
      stroke: asStr(o.strokeColor, '#111111'),
      strokeWidth: asNum(o.strokeWidth, 2),
      ...(o.locked === true ? { locked: true } : {}),
    }
  }

  if (type === 'image') {
    const fileId = typeof o.fileId === 'string' ? o.fileId : null
    if (!fileId) return null
    return {
      id,
      type: 'image',
      x: asNum(o.x),
      y: asNum(o.y),
      w: asNum(o.width, 100),
      h: asNum(o.height, 100),
      fileId,
      ...(o.locked === true ? { locked: true } : {}),
    }
  }

  // diamond, freedraw, frame, embeddable, … → skip
  return null
}

/**
 * Map a parsed excalidraw (or opaque) scene object to hip-board.
 * Does not read/write disk. Caller applies LKD-8 upgrade rules.
 */
export function migrateExcalidrawToHipBoard(
  raw: unknown,
  opts?: { boardId?: string },
): MigrateExcalidrawResult {
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const srcElements = Array.isArray(o.elements) ? o.elements : []
  const sourceHadElements = srcElements.length > 0

  const elements: HipBoardElement[] = []
  let skipped = 0
  for (const el of srcElements) {
    const mapped = mapElement(el)
    if (mapped) elements.push(mapped)
    else if (el && typeof el === 'object' && (el as { isDeleted?: boolean }).isDeleted !== true) {
      skipped++
    }
  }

  // Image elements without a corresponding hipAssetRel file entry are stripped.
  const srcFiles =
    o.files && typeof o.files === 'object' && !Array.isArray(o.files)
      ? (o.files as Record<string, unknown>)
      : {}
  const files: Record<string, HipBoardFileOnDisk> = {}
  for (const [fileId, f] of Object.entries(srcFiles)) {
    if (!f || typeof f !== 'object') continue
    const fo = f as Record<string, unknown>
    const rel = fo.hipAssetRel
    if (typeof rel !== 'string' || rel.length === 0) continue
    files[fileId] = {
      id: typeof fo.id === 'string' ? fo.id : fileId,
      mimeType: typeof fo.mimeType === 'string' ? fo.mimeType : 'image/png',
      created: typeof fo.created === 'number' ? fo.created : Date.now(),
      hipAssetRel: rel,
    }
  }

  const keptElements = elements.filter((el) => {
    if (el.type !== 'image') return true
    if (files[el.fileId]) return true
    skipped++
    return false
  })

  const appStateRaw =
    o.appState && typeof o.appState === 'object' && !Array.isArray(o.appState)
      ? (o.appState as Record<string, unknown>)
      : {}

  const scene: HipBoardSceneDisk = {
    type: 'hip-board',
    version: 1,
    source: 'hip',
    hip: {
      schemaVersion: 1,
      ...(opts?.boardId ? { boardId: opts.boardId } : {}),
    },
    elements: keptElements,
    appState: {
      viewBackgroundColor:
        typeof appStateRaw.viewBackgroundColor === 'string'
          ? appStateRaw.viewBackgroundColor
          : '#ffffff',
    },
    files,
  }

  const unsupported = sourceHadElements && keptElements.length === 0
  return { scene, skipped, unsupported, sourceHadElements }
}
