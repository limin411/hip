// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import {
  COMPAT_DISMISS_TTL_MS,
  KNOWLEDGE_EDITOR_MODE_BY_DOC_KEY,
  KNOWLEDGE_EDITOR_MODE_PREF_KEY,
  KNOWLEDGE_LIVE_FLAG_KEY,
  dismissCompatBanner,
  isCompatDismissed,
  isKnowledgeLiveEnabled,
  loadDocEditorMode,
  loadEditorModePref,
  persistDocEditorMode,
  persistEditorModePref,
  resolveEditorMode,
  shouldAutosave,
} from './editorMode'

describe('shouldAutosave', () => {
  it('is true for live and source', () => {
    expect(shouldAutosave('live')).toBe(true)
    expect(shouldAutosave('source')).toBe(true)
  })

  it('is true for legacy preview (compat read only)', () => {
    expect(shouldAutosave('preview')).toBe(true)
  })
})

describe('V2-E0 editor model convergence (live is the only editing surface)', () => {
  afterEach(() => {
    localStorage.removeItem(KNOWLEDGE_LIVE_FLAG_KEY)
    localStorage.removeItem(KNOWLEDGE_EDITOR_MODE_PREF_KEY)
    localStorage.removeItem(KNOWLEDGE_EDITOR_MODE_BY_DOC_KEY)
    localStorage.removeItem('hip-knowledge-compat-dismissed-v1')
  })

  it('isKnowledgeLiveEnabled is always true (flag value ignored)', () => {
    expect(isKnowledgeLiveEnabled()).toBe(true)
    localStorage.setItem(KNOWLEDGE_LIVE_FLAG_KEY, 'true')
    expect(isKnowledgeLiveEnabled()).toBe(true)
  })

  it('compat: residual hip-knowledge-live=false still behaves as live', () => {
    localStorage.setItem(KNOWLEDGE_LIVE_FLAG_KEY, 'false')
    expect(isKnowledgeLiveEnabled()).toBe(true)
    expect(resolveEditorMode('live')).toBe('live')
  })

  it('loadEditorModePref always returns live (stored source pref retired)', () => {
    expect(loadEditorModePref()).toBe('live')
    persistEditorModePref('source')
    expect(loadEditorModePref()).toBe('live')
    localStorage.setItem(KNOWLEDGE_EDITOR_MODE_PREF_KEY, 'source')
    expect(loadEditorModePref()).toBe('live')
  })

  it('loadDocEditorMode always returns null (per-doc memory retired)', () => {
    expect(loadDocEditorMode('doc_a')).toBeNull()
    persistDocEditorMode('doc_a', 'source')
    localStorage.setItem(
      KNOWLEDGE_EDITOR_MODE_BY_DOC_KEY,
      JSON.stringify({ doc_a: 'source' }),
    )
    expect(loadDocEditorMode('doc_a')).toBeNull()
  })

  it('persist calls are no-ops (no mode writes from user paths)', () => {
    persistEditorModePref('source')
    persistDocEditorMode('doc_a', 'source')
    expect(localStorage.getItem(KNOWLEDGE_EDITOR_MODE_PREF_KEY)).toBeNull()
    expect(localStorage.getItem(KNOWLEDGE_EDITOR_MODE_BY_DOC_KEY)).toBeNull()
  })

  it('resolveEditorMode: preview → live; source only when explicitly passed', () => {
    expect(resolveEditorMode('preview')).toBe('live')
    expect(resolveEditorMode('live')).toBe('live')
    // Internal fallback path (large doc / parse fail) may still request source.
    expect(resolveEditorMode('source')).toBe('source')
  })

  it('no flag/pref can derive source: flag false + pref source + per-doc source → live', () => {
    localStorage.setItem(KNOWLEDGE_LIVE_FLAG_KEY, 'false')
    localStorage.setItem(KNOWLEDGE_EDITOR_MODE_PREF_KEY, 'source')
    localStorage.setItem(
      KNOWLEDGE_EDITOR_MODE_BY_DOC_KEY,
      JSON.stringify({ doc_a: 'source' }),
    )
    expect(resolveEditorMode('live')).toBe('live')
    expect(resolveEditorMode('preview')).toBe('live')
  })
})

describe('compat-view banner dismissal (V2-E0 internal fallback notice)', () => {
  afterEach(() => {
    localStorage.removeItem('hip-knowledge-compat-dismissed-v1')
  })

  it('isCompatDismissed false by default; true after dismiss within TTL', () => {
    const now = Date.UTC(2026, 5, 9, 12, 0, 0)
    expect(isCompatDismissed('doc_a', now)).toBe(false)
    dismissCompatBanner('doc_a', now)
    expect(isCompatDismissed('doc_a', now)).toBe(true)
    expect(isCompatDismissed('doc_a', now + 60_000)).toBe(true)
    // 24h quiet window.
    expect(isCompatDismissed('doc_a', now + COMPAT_DISMISS_TTL_MS + 1)).toBe(false)
  })

  it('dismissal is per-doc', () => {
    const now = Date.now()
    dismissCompatBanner('doc_a', now)
    expect(isCompatDismissed('doc_a', now)).toBe(true)
    expect(isCompatDismissed('doc_b', now)).toBe(false)
  })
})
