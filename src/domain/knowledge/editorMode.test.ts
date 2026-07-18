// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_EDITOR_MODE_PREF_KEY,
  KNOWLEDGE_LIVE_FLAG_KEY,
  isKnowledgeLiveEnabled,
  loadEditorModePref,
  persistEditorModePref,
  resolveEditorMode,
  shouldAutosave,
} from './editorMode'

describe('shouldAutosave', () => {
  it('is true for live and source', () => {
    expect(shouldAutosave('live')).toBe(true)
    expect(shouldAutosave('source')).toBe(true)
  })

  it('is false for preview', () => {
    expect(shouldAutosave('preview')).toBe(false)
  })
})

describe('live flag + editor mode pref (product-on Live / 所见即所得)', () => {
  afterEach(() => {
    localStorage.removeItem(KNOWLEDGE_LIVE_FLAG_KEY)
    localStorage.removeItem(KNOWLEDGE_EDITOR_MODE_PREF_KEY)
  })

  it('isKnowledgeLiveEnabled defaults true when key absent (WYSIWYG product default)', () => {
    expect(isKnowledgeLiveEnabled()).toBe(true)
  })

  it('isKnowledgeLiveEnabled true when flag is exact "true"', () => {
    localStorage.setItem(KNOWLEDGE_LIVE_FLAG_KEY, 'true')
    expect(isKnowledgeLiveEnabled()).toBe(true)
  })

  it('isKnowledgeLiveEnabled false on explicit "false" or non-true values', () => {
    localStorage.setItem(KNOWLEDGE_LIVE_FLAG_KEY, 'false')
    expect(isKnowledgeLiveEnabled()).toBe(false)
    localStorage.setItem(KNOWLEDGE_LIVE_FLAG_KEY, '1')
    expect(isKnowledgeLiveEnabled()).toBe(false)
    localStorage.setItem(KNOWLEDGE_LIVE_FLAG_KEY, '0')
    expect(isKnowledgeLiveEnabled()).toBe(false)
  })

  it('loadEditorModePref defaults live when flag on and no pref', () => {
    expect(loadEditorModePref()).toBe('live')
  })

  it('loadEditorModePref is source when flag explicitly off', () => {
    localStorage.setItem(KNOWLEDGE_LIVE_FLAG_KEY, 'false')
    localStorage.setItem(KNOWLEDGE_EDITOR_MODE_PREF_KEY, 'live')
    expect(loadEditorModePref()).toBe('source')
  })

  it('loadEditorModePref respects stored source when flag on', () => {
    persistEditorModePref('source')
    expect(loadEditorModePref()).toBe('source')
  })

  it('loadEditorModePref respects stored live when flag on', () => {
    persistEditorModePref('live')
    expect(loadEditorModePref()).toBe('live')
  })

  it('resolveEditorMode clamps live → source when flag off', () => {
    localStorage.setItem(KNOWLEDGE_LIVE_FLAG_KEY, 'false')
    expect(resolveEditorMode('live')).toBe('source')
    expect(resolveEditorMode('source')).toBe('source')
    expect(resolveEditorMode('preview')).toBe('preview')
  })

  it('resolveEditorMode keeps live when flag on (default)', () => {
    expect(resolveEditorMode('live')).toBe('live')
  })
})
