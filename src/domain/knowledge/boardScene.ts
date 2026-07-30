/**
 * Board (Excalidraw whiteboard) scene types and pure helpers.
 *
 * Invariant (KD-6): on-disk / store draft is always dehydrated — `files[*]` has
 * `hipAssetRel`, never `dataURL`. Runtime BinaryFiles live only in the canvas component.
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

export type HipBoardSceneDisk = {
  type: 'excalidraw'
  version: number
  source: 'hip'
  hip?: { schemaVersion: number; boardId?: string }
  elements: unknown[]
  appState: Record<string, unknown>
  files: Record<string, HipBoardFileOnDisk>
}

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

/** Empty dehydrated scene written on createBoard / missing file. */
export const EMPTY_BOARD_SCENE: HipBoardSceneDisk = {
  type: 'excalidraw',
  version: 2,
  source: 'hip',
  hip: { schemaVersion: 1 },
  elements: [],
  appState: { viewBackgroundColor: '#ffffff' },
  files: {},
}

/** Stable empty-scene JSON for create / missing-file fallbacks. */
export const EMPTY_BOARD_SCENE_JSON: string = stableSerializeBoard(EMPTY_BOARD_SCENE)

/**
 * Parse a board scene from JSON. Throws on invalid JSON or wrong top-level shape.
 * Does not validate dataURL absence (use assertNoDataUrlInBoardJson for that).
 */
export function parseBoardScene(raw: string): HipBoardSceneDisk {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid board scene: expected object')
  }
  const o = parsed as Record<string, unknown>
  if (o.type !== 'excalidraw') {
    throw new Error('invalid board scene: type must be excalidraw')
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
 */
export function stableSerializeBoard(scene: HipBoardSceneDisk): string {
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
    type: 'excalidraw',
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
