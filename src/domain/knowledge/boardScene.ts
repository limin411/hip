/**
 * Board scene types and pure helpers (Excalidraw + hip-board dual track).
 *
 * Invariant (KD-6): on-disk / store draft is always dehydrated — `files[*]` has
 * `hipAssetRel`, never `dataURL`. Runtime BinaryFiles live only in the canvas component.
 *
 * PR-1: parse accepts both `excalidraw` and `hip-board`. Production EMPTY / createBoard
 * remain excalidraw until PR-C cutover (LKD-C).
 */

/** Max UTF-8 body size for knowledge_write_board (aligned with asset disk cap). */
export const KNOWLEDGE_BOARD_MAX_BYTES = 25 * 1024 * 1024

/** On-disk / draftBody / knowledge_write_board body file entry. */
export type HipBoardFileOnDisk = {
  id: string
  mimeType: string
  created: number
  hipAssetRel: string
  // dataURL MUST NOT be present
}

// ─── Hip native element model (engine types; production EMPTY stays excalidraw) ─

export type HipBoardElementType =
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'text'
  | 'image'

export type HipBoardElementBase = {
  id: string
  type: HipBoardElementType
  x: number
  y: number
  /** v1: always 0 (reserved). */
  rotation?: number
  locked?: boolean
}

export type HipBoardRect = HipBoardElementBase & {
  type: 'rect'
  w: number
  h: number
  fill: string
  stroke: string
  strokeWidth: number
  cornerRadius: number
}

export type HipBoardEllipse = HipBoardElementBase & {
  type: 'ellipse'
  w: number
  h: number
  fill: string
  stroke: string
  strokeWidth: number
}

export type HipBoardLine = HipBoardElementBase & {
  type: 'line' | 'arrow'
  x2: number
  y2: number
  stroke: string
  strokeWidth: number
}

export type HipBoardText = HipBoardElementBase & {
  type: 'text'
  w: number
  h: number
  text: string
  fill: string
  fontSize: 12 | 16 | 24
  fontWeight?: 400 | 600
}

export type HipBoardImage = HipBoardElementBase & {
  type: 'image'
  w: number
  h: number
  fileId: string
}

export type HipBoardElement =
  | HipBoardRect
  | HipBoardEllipse
  | HipBoardLine
  | HipBoardText
  | HipBoardImage

/** Session-only camera (LKD-14); never persisted to draft/disk. */
export type HipBoardCamera = { x: number; y: number; zoom: number }

export const HIP_BOARD_ZOOM_MIN = 0.25
export const HIP_BOARD_ZOOM_MAX = 4
export const HIP_BOARD_DEFAULT_CAMERA: HipBoardCamera = { x: 0, y: 0, zoom: 1 }

export type HipBoardAppStateDisk = {
  viewBackgroundColor: string
  gridSize?: number | null
  // camera / selectedIds MUST NOT be present (LKD-14 / LKD-16)
}

/**
 * Target disk / draft shape for the hip SVG engine (`type: "hip-board"`).
 * Production EMPTY stays LegacyExcalidrawSceneDisk until PR-C.
 */
export type HipBoardSceneDisk = {
  type: 'hip-board'
  version: 1
  source: 'hip'
  hip: { schemaVersion: 1; boardId?: string }
  elements: HipBoardElement[]
  appState: HipBoardAppStateDisk
  files: Record<string, HipBoardFileOnDisk>
}

/**
 * Legacy Excalidraw dehydrated scene (production createBoard / EMPTY until PR-C).
 * Elements are opaque Excalidraw shapes.
 */
export type LegacyExcalidrawSceneDisk = {
  type: 'excalidraw'
  version: number
  source: 'hip'
  hip?: { schemaVersion: number; boardId?: string }
  elements: unknown[]
  appState: Record<string, unknown>
  files: Record<string, HipBoardFileOnDisk>
}

/** Dual-accept on-disk / draft body. */
export type BoardSceneDisk = HipBoardSceneDisk | LegacyExcalidrawSceneDisk

/**
 * Runtime only — never stringified into draftBody.
 * Shape matches Excalidraw BinaryFileData (id, mimeType, dataURL, created, …).
 */
export type HipBoardFileRuntime = {
  id: string
  mimeType: string
  created: number
  dataURL: string
}

export type HipBoardFilesRuntime = Record<string, HipBoardFileRuntime>

/** Empty dehydrated scene written on createBoard / missing file (excalidraw until PR-C). */
export const EMPTY_BOARD_SCENE: LegacyExcalidrawSceneDisk = {
  type: 'excalidraw',
  version: 2,
  source: 'hip',
  hip: { schemaVersion: 1 },
  elements: [],
  appState: { viewBackgroundColor: '#ffffff' },
  files: {},
}

/**
 * Empty hip-board scene for engine fixtures / tests.
 * Not used by createBoard until PR-C (LKD-C).
 */
export const EMPTY_HIP_BOARD_SCENE: HipBoardSceneDisk = {
  type: 'hip-board',
  version: 1,
  source: 'hip',
  hip: { schemaVersion: 1 },
  elements: [],
  appState: { viewBackgroundColor: '#ffffff' },
  files: {},
}

/** Stable empty-scene JSON for create / missing-file fallbacks (excalidraw). */
export const EMPTY_BOARD_SCENE_JSON: string = stableSerializeBoard(EMPTY_BOARD_SCENE)

/** Stable empty hip-board JSON (fixtures only until PR-C). */
export const EMPTY_HIP_BOARD_SCENE_JSON: string = stableSerializeBoard(EMPTY_HIP_BOARD_SCENE)

export function isHipBoardScene(scene: BoardSceneDisk): scene is HipBoardSceneDisk {
  return scene.type === 'hip-board'
}

export function isExcalidrawScene(scene: BoardSceneDisk): scene is LegacyExcalidrawSceneDisk {
  return scene.type === 'excalidraw'
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Lightweight structural validate-or-skip for hip-board elements.
 * Corrupt/partial entries are omitted rather than thrown (parse still succeeds).
 */
export function validateHipBoardElement(raw: unknown): HipBoardElement | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id.length === 0) return null
  if (!isFiniteNum(o.x) || !isFiniteNum(o.y)) return null
  const locked = o.locked === true ? true : undefined

  switch (o.type) {
    case 'rect': {
      if (!isFiniteNum(o.w) || !isFiniteNum(o.h)) return null
      if (typeof o.fill !== 'string' || typeof o.stroke !== 'string') return null
      if (!isFiniteNum(o.strokeWidth) || !isFiniteNum(o.cornerRadius)) return null
      return {
        id: o.id,
        type: 'rect',
        x: o.x,
        y: o.y,
        w: o.w,
        h: o.h,
        fill: o.fill,
        stroke: o.stroke,
        strokeWidth: o.strokeWidth,
        cornerRadius: o.cornerRadius,
        ...(locked ? { locked } : {}),
      }
    }
    case 'ellipse': {
      if (!isFiniteNum(o.w) || !isFiniteNum(o.h)) return null
      if (typeof o.fill !== 'string' || typeof o.stroke !== 'string') return null
      if (!isFiniteNum(o.strokeWidth)) return null
      return {
        id: o.id,
        type: 'ellipse',
        x: o.x,
        y: o.y,
        w: o.w,
        h: o.h,
        fill: o.fill,
        stroke: o.stroke,
        strokeWidth: o.strokeWidth,
        ...(locked ? { locked } : {}),
      }
    }
    case 'line':
    case 'arrow': {
      if (!isFiniteNum(o.x2) || !isFiniteNum(o.y2)) return null
      if (typeof o.stroke !== 'string' || !isFiniteNum(o.strokeWidth)) return null
      return {
        id: o.id,
        type: o.type,
        x: o.x,
        y: o.y,
        x2: o.x2,
        y2: o.y2,
        stroke: o.stroke,
        strokeWidth: o.strokeWidth,
        ...(locked ? { locked } : {}),
      }
    }
    case 'text': {
      if (!isFiniteNum(o.w) || !isFiniteNum(o.h)) return null
      if (typeof o.text !== 'string' || typeof o.fill !== 'string') return null
      const fontSize = o.fontSize
      if (fontSize !== 12 && fontSize !== 16 && fontSize !== 24) return null
      const fontWeight =
        o.fontWeight === 400 || o.fontWeight === 600 ? o.fontWeight : undefined
      return {
        id: o.id,
        type: 'text',
        x: o.x,
        y: o.y,
        w: o.w,
        h: o.h,
        text: o.text,
        fill: o.fill,
        fontSize,
        ...(fontWeight !== undefined ? { fontWeight } : {}),
        ...(locked ? { locked } : {}),
      }
    }
    case 'image': {
      if (!isFiniteNum(o.w) || !isFiniteNum(o.h)) return null
      if (typeof o.fileId !== 'string' || o.fileId.length === 0) return null
      return {
        id: o.id,
        type: 'image',
        x: o.x,
        y: o.y,
        w: o.w,
        h: o.h,
        fileId: o.fileId,
        ...(locked ? { locked } : {}),
      }
    }
    default:
      return null
  }
}

/**
 * Parse a board scene from JSON. Throws on invalid JSON or wrong top-level shape.
 * Accepts both `type: "excalidraw"` and `type: "hip-board"` (PR-1 dual parse).
 * Does not validate dataURL absence (use assertNoDataUrlInBoardJson for that).
 */
export function parseBoardScene(raw: string): BoardSceneDisk {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid board scene: expected object')
  }
  const o = parsed as Record<string, unknown>
  if (o.type !== 'excalidraw' && o.type !== 'hip-board') {
    throw new Error('invalid board scene: type must be excalidraw or hip-board')
  }
  const files =
    o.files && typeof o.files === 'object' && !Array.isArray(o.files)
      ? (o.files as Record<string, HipBoardFileOnDisk>)
      : {}
  const elements = Array.isArray(o.elements) ? o.elements : []
  const appState =
    o.appState && typeof o.appState === 'object' && !Array.isArray(o.appState)
      ? (o.appState as Record<string, unknown>)
      : { viewBackgroundColor: '#ffffff' }
  const hip =
    o.hip && typeof o.hip === 'object' && !Array.isArray(o.hip)
      ? (o.hip as { schemaVersion: number; boardId?: string })
      : undefined

  if (o.type === 'hip-board') {
    const validated: HipBoardElement[] = []
    for (const el of elements) {
      const v = validateHipBoardElement(el)
      if (v) validated.push(v)
    }
    return {
      type: 'hip-board',
      version: 1,
      source: 'hip',
      hip: {
        schemaVersion: 1,
        ...(hip?.boardId ? { boardId: hip.boardId } : {}),
      },
      elements: validated,
      appState: {
        viewBackgroundColor:
          typeof appState.viewBackgroundColor === 'string'
            ? appState.viewBackgroundColor
            : '#ffffff',
        ...(appState.gridSize !== undefined ? { gridSize: appState.gridSize as number | null } : {}),
      },
      files,
    }
  }

  return {
    type: 'excalidraw',
    version: typeof o.version === 'number' ? o.version : 2,
    source: 'hip',
    ...(hip ? { hip } : {}),
    elements,
    appState,
    files,
  }
}

/**
 * Stable JSON serialization for dirty checks and disk writes.
 * Key order is fixed so string equality is meaningful for dehydrated scenes.
 * Preserves scene.type (excalidraw | hip-board).
 */
export function stableSerializeBoard(scene: BoardSceneDisk): string {
  // Serialize files with sorted keys for stability; elements keep author order.
  const fileIds = Object.keys(scene.files).sort()
  const files: Record<string, HipBoardFileOnDisk> = {}
  for (const id of fileIds) {
    const f = scene.files[id]
    files[id] = {
      id: f.id,
      mimeType: f.mimeType,
      created: f.created,
      hipAssetRel: f.hipAssetRel,
    }
  }
  const out: Record<string, unknown> = {
    type: scene.type,
    version: scene.version,
    source: 'hip',
  }
  if (scene.hip) {
    out.hip = scene.hip
  }
  out.elements = scene.elements
  out.appState = scene.appState
  out.files = files
  return JSON.stringify(out)
}

/** Serialize a hip-board scene (alias of stableSerializeBoard for typed callers). */
export function serializeHipBoard(scene: HipBoardSceneDisk): string {
  return stableSerializeBoard(scene)
}

/**
 * Field-level guard: reject if any files[*] entry has an own property `dataURL`.
 * Does NOT search the whole body for the substring "dataURL" (element text may contain it).
 */
export function assertNoDataUrlInBoardJson(raw: string): void {
  const scene = JSON.parse(raw) as { files?: Record<string, unknown> }
  const files = scene.files
  if (!files || typeof files !== 'object') return
  for (const [id, f] of Object.entries(files)) {
    if (f && typeof f === 'object' && Object.prototype.hasOwnProperty.call(f, 'dataURL')) {
      throw new Error(`board file ${id} must not contain dataURL`)
    }
  }
}

/** appState fields persisted to disk / store draft (KD-6). Theme is injected at runtime. */
export const BOARD_APP_STATE_PERSIST_KEYS = [
  'viewBackgroundColor',
  'gridSize',
  'gridModeEnabled',
  'scrollX',
  'scrollY',
  'zoom',
] as const

export type BoardAppStatePersistKey = (typeof BOARD_APP_STATE_PERSIST_KEYS)[number]

/** Whitelist appState for disk / draft. */
export function pickPersistAppState(
  appState: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { viewBackgroundColor: '#ffffff' }
  if (!appState || typeof appState !== 'object') return out
  for (const key of BOARD_APP_STATE_PERSIST_KEYS) {
    if (key in appState) {
      out[key] = appState[key]
    }
  }
  return out
}

/**
 * Build dehydrated on-disk scene from runtime refs (Excalidraw production path).
 * `relByFileId` only includes completed imports (hipAssetRel); pending files omitted.
 * Remains type:excalidraw until PR-C.
 */
export function buildDiskScene(args: {
  elements: unknown[]
  appState: Record<string, unknown> | null | undefined
  /** fileId → completed hipAssetRel */
  relByFileId: ReadonlyMap<string, string> | Record<string, string>
  /** Optional runtime files for mimeType / created (when rel exists). */
  runtimeFiles?: HipBoardFilesRuntime | Record<string, { mimeType?: string; created?: number }>
  boardId?: string
}): LegacyExcalidrawSceneDisk {
  const relMap =
    args.relByFileId instanceof Map
      ? args.relByFileId
      : new Map(Object.entries(args.relByFileId))

  const files: Record<string, HipBoardFileOnDisk> = {}
  for (const [fileId, rel] of relMap) {
    if (!rel || typeof rel !== 'string') continue
    const rt = args.runtimeFiles?.[fileId]
    files[fileId] = {
      id: fileId,
      mimeType: rt?.mimeType && typeof rt.mimeType === 'string' ? rt.mimeType : 'image/png',
      created:
        rt && typeof rt.created === 'number' && Number.isFinite(rt.created)
          ? rt.created
          : Date.now(),
      hipAssetRel: rel,
    }
  }

  return {
    type: 'excalidraw',
    version: 2,
    source: 'hip',
    hip: {
      schemaVersion: 1,
      ...(args.boardId ? { boardId: args.boardId } : {}),
    },
    elements: Array.isArray(args.elements) ? args.elements : [],
    appState: pickPersistAppState(args.appState),
    files,
  }
}

/**
 * Build dehydrated hip-board scene from engine refs (fixtures / PR-C+).
 * Not used by production createBoard until cutover.
 */
export function buildHipDiskScene(args: {
  elements: HipBoardElement[]
  appState?: Partial<HipBoardAppStateDisk> | null
  relByFileId: ReadonlyMap<string, string> | Record<string, string>
  runtimeFiles?: Record<string, { mimeType?: string; created?: number }>
  boardId?: string
}): HipBoardSceneDisk {
  const relMap =
    args.relByFileId instanceof Map
      ? args.relByFileId
      : new Map(Object.entries(args.relByFileId))

  const files: Record<string, HipBoardFileOnDisk> = {}
  for (const [fileId, rel] of relMap) {
    if (!rel || typeof rel !== 'string') continue
    const rt = args.runtimeFiles?.[fileId]
    files[fileId] = {
      id: fileId,
      mimeType: rt?.mimeType && typeof rt.mimeType === 'string' ? rt.mimeType : 'image/png',
      created:
        rt && typeof rt.created === 'number' && Number.isFinite(rt.created)
          ? rt.created
          : Date.now(),
      hipAssetRel: rel,
    }
  }

  return {
    type: 'hip-board',
    version: 1,
    source: 'hip',
    hip: {
      schemaVersion: 1,
      ...(args.boardId ? { boardId: args.boardId } : {}),
    },
    elements: Array.isArray(args.elements) ? args.elements : [],
    appState: {
      viewBackgroundColor:
        typeof args.appState?.viewBackgroundColor === 'string'
          ? args.appState.viewBackgroundColor
          : '#ffffff',
      ...(args.appState?.gridSize !== undefined ? { gridSize: args.appState.gridSize } : {}),
    },
    files,
  }
}

/** Approximate raw byte length of a data URL payload (base64). */
export function estimateDataUrlBytes(dataURL: string): number {
  if (!dataURL || typeof dataURL !== 'string') return 0
  const i = dataURL.indexOf(',')
  const b64 = i >= 0 ? dataURL.slice(i + 1) : dataURL
  // 4 base64 chars → 3 bytes; ignore padding edge (close enough for caps).
  return Math.floor((b64.length * 3) / 4)
}

/** Extract base64 payload from a data URL (no prefix). */
export function dataUrlToBase64(dataURL: string): string {
  const i = dataURL.indexOf(',')
  return i >= 0 ? dataURL.slice(i + 1) : dataURL
}

/**
 * Drop image elements whose `fileId` is in `fileIds` (leave-mode pending drop).
 * Non-image elements and images with other fileIds are kept as-is.
 */
export function stripImageElementsForFiles(
  elements: unknown[],
  fileIds: ReadonlySet<string>,
): unknown[] {
  if (fileIds.size === 0) return elements
  return elements.filter((el) => {
    if (!el || typeof el !== 'object') return true
    const o = el as { type?: string; fileId?: string; isDeleted?: boolean }
    if (o.type !== 'image') return true
    if (o.fileId && fileIds.has(o.fileId)) return false
    return true
  })
}

export type HydrateBoardFilesResult = {
  files: HipBoardFilesRuntime
  /** fileId → hipAssetRel for entries that hydrated successfully */
  relByFileId: Map<string, string>
  /** fileIds that failed to load (omitted from files) */
  failedIds: string[]
}

/**
 * Load BinaryFiles from disk `hipAssetRel` via existing asset IPC / cache.
 * Failed entries are omitted (caller toasts once).
 */
export async function hydrateBoardFiles(
  spaceId: string,
  diskFiles: Record<string, HipBoardFileOnDisk>,
  opts?: {
    resolve?: (
      spaceId: string,
      relPath: string,
    ) => Promise<{ dataUrl: string; mime: string } | null>
  },
): Promise<HydrateBoardFilesResult> {
  const { resolveAssetDataUrl } = await import('./assetUrl')
  const resolve = opts?.resolve ?? resolveAssetDataUrl
  const files: HipBoardFilesRuntime = {}
  const relByFileId = new Map<string, string>()
  const failedIds: string[] = []

  const entries = Object.entries(diskFiles ?? {})
  await Promise.all(
    entries.map(async ([id, f]) => {
      if (!f || typeof f !== 'object') {
        failedIds.push(id)
        return
      }
      const rel = f.hipAssetRel
      if (!rel || typeof rel !== 'string') {
        failedIds.push(id)
        return
      }
      try {
        const resolved = await resolve(spaceId, rel)
        if (!resolved?.dataUrl) {
          failedIds.push(id)
          return
        }
        files[id] = {
          id,
          mimeType: f.mimeType || resolved.mime || 'image/png',
          created: typeof f.created === 'number' ? f.created : Date.now(),
          dataURL: resolved.dataUrl,
        }
        relByFileId.set(id, rel)
      } catch {
        failedIds.push(id)
      }
    }),
  )

  return { files, relByFileId, failedIds }
}

/**
 * Import a runtime BinaryFile (dataURL) into space assets; returns hipAssetRel.
 * Caller enforces inline size cap before calling.
 */
export async function importBoardFileBytes(
  spaceId: string,
  file: HipBoardFileRuntime,
  opts?: {
    importBytes?: (
      spaceId: string,
      args: { base64: string; fileName: string; mime: string },
    ) => Promise<{ relPath: string; mime: string; byteLength: number }>
  },
): Promise<string> {
  const { knowledgeImportAssetBytes } = await import('@/ipc/knowledge')
  const importBytes = opts?.importBytes ?? knowledgeImportAssetBytes
  const mime = file.mimeType || 'image/png'
  const ext =
    mime === 'image/jpeg'
      ? 'jpg'
      : mime === 'image/gif'
        ? 'gif'
        : mime === 'image/webp'
          ? 'webp'
          : 'png'
  const base64 = dataUrlToBase64(file.dataURL)
  const meta = await importBytes(spaceId, {
    base64,
    fileName: `board-${file.id}.${ext}`,
    mime,
  })
  return meta.relPath
}
