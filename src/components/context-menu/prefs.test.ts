// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  CONTEXT_MENU_PREFS_KEY,
  defaultContextMenuPrefs,
  loadPrefs,
  savePrefs,
} from './prefs'

beforeEach(() => {
  localStorage.clear()
})

describe('prefs', () => {
  it('defaults when empty', () => {
    expect(loadPrefs()).toEqual(defaultContextMenuPrefs())
    expect(loadPrefs().disabledIds).toEqual([])
  })

  it('round-trips disabledIds', () => {
    savePrefs({ version: 1, disabledIds: ['message.copy', 'file.open'] })
    expect(loadPrefs()).toEqual({
      version: 1,
      disabledIds: ['message.copy', 'file.open'],
    })
    expect(localStorage.getItem(CONTEXT_MENU_PREFS_KEY)).toContain('message.copy')
  })

  it('recovers from corrupt JSON', () => {
    localStorage.setItem(CONTEXT_MENU_PREFS_KEY, '{not json')
    expect(loadPrefs()).toEqual(defaultContextMenuPrefs())
  })

  it('ignores non-string disabledIds entries', () => {
    localStorage.setItem(
      CONTEXT_MENU_PREFS_KEY,
      JSON.stringify({ version: 1, disabledIds: ['ok', 1, null, 'also'] }),
    )
    expect(loadPrefs().disabledIds).toEqual(['ok', 'also'])
  })
})
