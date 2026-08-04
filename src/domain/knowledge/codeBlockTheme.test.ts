import { describe, expect, it } from 'vitest'
import {
  CODE_BLOCK_CHROME,
  normalizeCodeBlockThemeId,
  resolveShikiTheme,
} from './codeBlockTheme'

describe('normalizeCodeBlockThemeId', () => {
  it('defaults to follow', () => {
    expect(normalizeCodeBlockThemeId(undefined)).toBe('follow')
    expect(normalizeCodeBlockThemeId(null)).toBe('follow')
    expect(normalizeCodeBlockThemeId('')).toBe('follow')
  })

  it('accepts known ids case-insensitively', () => {
    expect(normalizeCodeBlockThemeId('follow')).toBe('follow')
    expect(normalizeCodeBlockThemeId('Light')).toBe('light')
    expect(normalizeCodeBlockThemeId(' DARK ')).toBe('dark')
  })

  it('falls back for unknown ids', () => {
    expect(normalizeCodeBlockThemeId('dracula')).toBe('follow')
  })
})

describe('resolveShikiTheme', () => {
  it('maps forced light/dark', () => {
    expect(resolveShikiTheme('light', true)).toBe('github-light')
    expect(resolveShikiTheme('light', false)).toBe('github-light')
    expect(resolveShikiTheme('dark', false)).toBe('github-dark')
    expect(resolveShikiTheme('dark', true)).toBe('github-dark')
  })

  it('follows document dark', () => {
    expect(resolveShikiTheme('follow', true)).toBe('github-dark')
    expect(resolveShikiTheme('follow', false)).toBe('github-light')
  })
})

describe('CODE_BLOCK_CHROME', () => {
  it('provides readable light and dark palettes', () => {
    expect(CODE_BLOCK_CHROME.light.background).toBe('#ffffff')
    expect(CODE_BLOCK_CHROME.dark.background).toBe('#0d1117')
    expect(CODE_BLOCK_CHROME.light.text).not.toBe(CODE_BLOCK_CHROME.dark.text)
  })
})
