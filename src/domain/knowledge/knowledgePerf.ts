/**
 * Optional knowledge-editor performance marks for E2E / local diagnosis.
 *
 * Collection is off until `enable()` (or localStorage `hip-knowledge-perf=1`
 * at first mark). Hot paths check `isKnowledgePerfEnabled()` and no-op when off.
 *
 * Exposed as `window.__hipKnowledgePerf` when installWindowApi() runs
 * (imported from knowledgeStore so the seam exists in the app shell).
 */

export const KNOWLEDGE_PERF_FLAG_KEY = 'hip-knowledge-perf'

const MAX_SERIALIZE_SAMPLES = 64

export type KnowledgePerfOpenSnapshot = {
  /** performance.now() when openDoc started (this open). */
  openStartMs: number | null
  /** knowledgeReadDoc duration ms */
  ipcMs: number | null
  /** store set after body loaded (perf.now) */
  storeSetAt: number | null
  /** Milkdown Editor.make().create() duration ms */
  liveCreateMs: number | null
  /** ms from openStart → first editable (Live create end or Source ready) */
  firstEditableMs: number | null
  bodyChars: number | null
  editorMode: string | null
}

export type KnowledgePerfSnapshot = {
  enabled: boolean
  open: KnowledgePerfOpenSnapshot
  typing: {
    lastSerializeMs: number | null
    serializeSamples: number[]
    serializeCount: number
    draftSetCount: number
  }
  shiki: { calls: number; lastMs: number | null }
  mermaid: { renders: number; lastMs: number | null }
  nodeViews: { code: number; mermaid: number; svg: number }
}

type InternalState = {
  enabled: boolean
  open: KnowledgePerfOpenSnapshot
  serializeSamples: number[]
  serializeCount: number
  lastSerializeMs: number | null
  draftSetCount: number
  shikiCalls: number
  shikiLastMs: number | null
  mermaidRenders: number
  mermaidLastMs: number | null
  nodeViewCode: number
  nodeViewMermaid: number
  nodeViewSvg: number
}

function emptyOpen(): KnowledgePerfOpenSnapshot {
  return {
    openStartMs: null,
    ipcMs: null,
    storeSetAt: null,
    liveCreateMs: null,
    firstEditableMs: null,
    bodyChars: null,
    editorMode: null,
  }
}

function createState(enabled: boolean): InternalState {
  return {
    enabled,
    open: emptyOpen(),
    serializeSamples: [],
    serializeCount: 0,
    lastSerializeMs: null,
    draftSetCount: 0,
    shikiCalls: 0,
    shikiLastMs: null,
    mermaidRenders: 0,
    mermaidLastMs: null,
    nodeViewCode: 0,
    nodeViewMermaid: 0,
    nodeViewSvg: 0,
  }
}

let state = createState(false)
/** Temp start for live create duration (not part of public snapshot). */
let liveCreateT0: number | null = null

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function flagInStorage(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(KNOWLEDGE_PERF_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

/** True when marks should be recorded. */
export function isKnowledgePerfEnabled(): boolean {
  if (state.enabled) return true
  if (flagInStorage()) {
    state.enabled = true
    return true
  }
  return false
}

export function enableKnowledgePerf(): void {
  state.enabled = true
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(KNOWLEDGE_PERF_FLAG_KEY, '1')
    } catch {
      // ignore quota / private mode
    }
  }
}

export function disableKnowledgePerf(): void {
  state.enabled = false
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(KNOWLEDGE_PERF_FLAG_KEY)
    } catch {
      // ignore
    }
  }
}

/** Clear samples but keep enabled flag. */
export function resetKnowledgePerf(): void {
  const enabled = state.enabled || flagInStorage()
  state = createState(enabled)
}

export function knowledgePerfSnapshot(): KnowledgePerfSnapshot {
  return {
    enabled: isKnowledgePerfEnabled(),
    open: { ...state.open },
    typing: {
      lastSerializeMs: state.lastSerializeMs,
      serializeSamples: state.serializeSamples.slice(),
      serializeCount: state.serializeCount,
      draftSetCount: state.draftSetCount,
    },
    shiki: { calls: state.shikiCalls, lastMs: state.shikiLastMs },
    mermaid: { renders: state.mermaidRenders, lastMs: state.mermaidLastMs },
    nodeViews: {
      code: state.nodeViewCode,
      mermaid: state.nodeViewMermaid,
      svg: state.nodeViewSvg,
    },
  }
}

// ── Open path ─────────────────────────────────────────────────────────────

export function kbPerfOpenStart(): void {
  if (!isKnowledgePerfEnabled()) return
  state.open = emptyOpen()
  state.open.openStartMs = now()
  mark('kb.open.start')
}

export function kbPerfOpenIpc(durationMs: number): void {
  if (!isKnowledgePerfEnabled()) return
  state.open.ipcMs = durationMs
  mark('kb.open.ipc', durationMs)
}

export function kbPerfOpenStore(bodyChars: number, editorMode: string): void {
  if (!isKnowledgePerfEnabled()) return
  state.open.storeSetAt = now()
  state.open.bodyChars = bodyChars
  state.open.editorMode = editorMode
  mark('kb.open.store')
}

export function kbPerfLiveCreateStart(): void {
  if (!isKnowledgePerfEnabled()) return
  liveCreateT0 = now()
  mark('kb.live.create.start')
}

export function kbPerfLiveCreateEnd(): void {
  if (!isKnowledgePerfEnabled()) return
  const ms = liveCreateT0 != null ? now() - liveCreateT0 : null
  liveCreateT0 = null
  state.open.liveCreateMs = ms
  if (ms != null) mark('kb.live.create.end', ms)
  // First editable ≈ live create complete when Live mounts.
  if (state.open.openStartMs != null) {
    state.open.firstEditableMs = now() - state.open.openStartMs
    mark('kb.live.firstEditable', state.open.firstEditableMs)
  }
}

export function kbPerfSourceReady(): void {
  if (!isKnowledgePerfEnabled()) return
  if (state.open.openStartMs != null && state.open.firstEditableMs == null) {
    state.open.firstEditableMs = now() - state.open.openStartMs
    mark('kb.source.firstEditable', state.open.firstEditableMs)
  }
}

// ── Typing / draft ────────────────────────────────────────────────────────

export function kbPerfSerialize(durationMs: number): void {
  if (!isKnowledgePerfEnabled()) return
  state.lastSerializeMs = durationMs
  state.serializeCount += 1
  state.serializeSamples.push(durationMs)
  if (state.serializeSamples.length > MAX_SERIALIZE_SAMPLES) {
    state.serializeSamples.shift()
  }
  mark('kb.md.serialize', durationMs)
}

export function kbPerfDraftSet(): void {
  if (!isKnowledgePerfEnabled()) return
  state.draftSetCount += 1
}

// ── Blocks ────────────────────────────────────────────────────────────────

export function kbPerfShiki(durationMs: number): void {
  if (!isKnowledgePerfEnabled()) return
  state.shikiCalls += 1
  state.shikiLastMs = durationMs
}

export function kbPerfMermaid(durationMs: number): void {
  if (!isKnowledgePerfEnabled()) return
  state.mermaidRenders += 1
  state.mermaidLastMs = durationMs
}

export function kbPerfNodeViewMount(kind: 'code' | 'mermaid' | 'svg'): void {
  if (!isKnowledgePerfEnabled()) return
  if (kind === 'code') state.nodeViewCode += 1
  else if (kind === 'mermaid') state.nodeViewMermaid += 1
  else state.nodeViewSvg += 1
}

function mark(name: string, detail?: number): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
  try {
    performance.mark(name, detail != null ? { detail } : undefined)
  } catch {
    // ignore invalid mark names / closed documents
  }
}

export type HipKnowledgePerfApi = {
  enable: () => void
  disable: () => void
  reset: () => void
  snapshot: () => KnowledgePerfSnapshot
  isEnabled: () => boolean
}

/** Install / refresh window.__hipKnowledgePerf (idempotent). */
export function installKnowledgePerfWindowApi(): void {
  if (typeof window === 'undefined') return
  const api: HipKnowledgePerfApi = {
    enable: enableKnowledgePerf,
    disable: disableKnowledgePerf,
    reset: resetKnowledgePerf,
    snapshot: knowledgePerfSnapshot,
    isEnabled: isKnowledgePerfEnabled,
  }
  window.__hipKnowledgePerf = api
}

declare global {
  interface Window {
    __hipKnowledgePerf?: HipKnowledgePerfApi
  }
}

/** Test helper — full reset including enabled flag + localStorage flag. */
export function __resetKnowledgePerfForTests(): void {
  liveCreateT0 = null
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(KNOWLEDGE_PERF_FLAG_KEY)
    } catch {
      // ignore
    }
  }
  state = createState(false)
}
