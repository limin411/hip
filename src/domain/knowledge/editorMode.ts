/**
 * Document pane mode (V2-E0 编辑模型收口).
 *
 * Product path is always real-time Live (Notion/Feishu-style) — **live 是唯一编辑表面**。
 * - `source` 仅内部兜底：live 渲染失败 / 超大文档时自动降级，**无任何用户入口**
 *   （无 UI / 快捷键 / 命令面板 / 按文档记忆）。
 * - `preview` 为历史遗留写入模式，读取时一律归一为 `live`。
 *
 * 旧 localStorage 键（KNOWLEDGE_LIVE_FLAG_KEY / KNOWLEDGE_EDITOR_MODE_PREF_KEY /
 * KNOWLEDGE_EDITOR_MODE_BY_DOC_KEY）的读取路径已退役：保留常量与注释以便理解旧数据，
 * 但值一律被忽略——残留 `hip-knowledge-live=false` 等数据不会再产生任何模式切换。
 */
export type EditorMode = 'live' | 'source' | 'preview'

/** Writable modes that schedule autosave on draft changes. */
export type WritableEditorMode = 'live' | 'source'

/**
 * 历史 localStorage 键（V2-E0 起只读兼容，值被忽略）：
 * - `hip-knowledge-live`：live 功能 flag（曾允许显式关闭）
 * - `hip-knowledge-editor-mode`：全局上次可写模式偏好
 * - `hip-knowledge-editor-mode-by-doc`：按文档模式记忆
 */
export const KNOWLEDGE_LIVE_FLAG_KEY = 'hip-knowledge-live'
export const KNOWLEDGE_EDITOR_MODE_PREF_KEY = 'hip-knowledge-editor-mode'
export const KNOWLEDGE_EDITOR_MODE_BY_DOC_KEY = 'hip-knowledge-editor-mode-by-doc'

/**
 * Autosave default when user types in a writable surface.
 * Legacy `preview` is treated as Live (writable) if still present in store.
 */
export function shouldAutosave(mode: EditorMode): boolean {
  return mode === 'live' || mode === 'source' || mode === 'preview'
}

/**
 * V2-E0：live 恒为产品默认。旧 flag 值被忽略（兼容读取保留，永不返回 false）。
 */
export function isKnowledgeLiveEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true
  try {
    // 兼容读取：值被忽略（V2-E0）。残留 `false` 也按 live 处理。
    localStorage.getItem(KNOWLEDGE_LIVE_FLAG_KEY)
  } catch {
    // ignore private-mode / quota
  }
  return true
}

/** V2-E0：恒返回 'live'；旧 pref（含 'source'）不再影响打开模式。 */
export function loadEditorModePref(): WritableEditorMode {
  return 'live'
}

/**
 * V2-E0：按文档模式记忆退役——恒返回 null（调用方默认 live）。
 * 旧 `editor-mode-by-doc` 数据不会再把文档打开成 source。
 */
export function loadDocEditorMode(_docId: string): WritableEditorMode | null {
  return null
}

/** V2-E0：模式持久化退役（source 仅内部兜底，无需记忆）。保留签名避免调用点报错。 */
export function persistDocEditorMode(_docId: string, _mode: WritableEditorMode): void {
  // no-op（V2-E0）
}

/** V2-E0：模式持久化退役。 */
export function persistEditorModePref(_mode: WritableEditorMode): void {
  // no-op（V2-E0）
}

/**
 * 收敛规则（V2-E0）：
 * - `preview`（历史遗留写入模式）→ `live`
 * - `source` 仅在**显式传入**时保留（内部兜底：live 渲染失败 / 超大文档）
 * - 任何 flag / pref / 记忆都不再推导出 `source`
 */
export function resolveEditorMode(mode: EditorMode): EditorMode {
  if (mode === 'source') return 'source'
  return 'live'
}

/** 兼容视图降级提示的 24h 免打扰：`{ [docId]: lastDismissedAt }`。 */
const COMPAT_DISMISS_KEY = 'hip-knowledge-compat-dismissed-v1'
export const COMPAT_DISMISS_TTL_MS = 24 * 60 * 60 * 1000

/** Whether the compat banner was dismissed within TTL for this doc. */
export function isCompatDismissed(docId: string, now: number = Date.now()): boolean {
  if (!docId || typeof localStorage === 'undefined') return false
  try {
    const raw = localStorage.getItem(COMPAT_DISMISS_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw) as Record<string, number>
    const at = typeof parsed?.[docId] === 'number' ? parsed[docId] : 0
    return at > 0 && now - at < COMPAT_DISMISS_TTL_MS
  } catch {
    return false
  }
}

/** Record a compat-banner dismissal for this doc (24h quiet). */
export function dismissCompatBanner(docId: string, now: number = Date.now()): void {
  if (!docId || typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(COMPAT_DISMISS_KEY)
    const parsed = (raw ? (JSON.parse(raw) as Record<string, number>) : {}) ?? {}
    parsed[docId] = now
    // Cap map size to avoid unbounded growth.
    const keys = Object.keys(parsed)
    if (keys.length > 500) {
      for (const k of keys.slice(0, keys.length - 500)) delete parsed[k]
    }
    localStorage.setItem(COMPAT_DISMISS_KEY, JSON.stringify(parsed))
  } catch {
    // ignore quota / private mode
  }
}
