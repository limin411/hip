import { describe, it, expect } from 'vitest'
import { matchTerminalKey, type TerminalKeyEventLike } from './terminalKeymap'

function ev(partial: Partial<TerminalKeyEventLike>): TerminalKeyEventLike {
  return {
    key: '',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...partial,
  }
}

describe('matchTerminalKey', () => {
  it('matches copy / paste / restart / scroll on both Cmd and Ctrl prefixes', () => {
    for (const prefix of ['metaKey', 'ctrlKey'] as const) {
      expect(matchTerminalKey(ev({ key: 'c', shiftKey: true, [prefix]: true }))).toBe('copy')
      expect(matchTerminalKey(ev({ key: 'C', shiftKey: true, [prefix]: true }))).toBe('copy')
      expect(matchTerminalKey(ev({ key: 'v', shiftKey: true, [prefix]: true }))).toBe('paste')
      expect(matchTerminalKey(ev({ key: 'r', shiftKey: true, [prefix]: true }))).toBe('restart')
      expect(matchTerminalKey(ev({ key: 'ArrowUp', shiftKey: true, [prefix]: true }))).toBe('scroll-top')
      expect(matchTerminalKey(ev({ key: 'ArrowDown', shiftKey: true, [prefix]: true }))).toBe('scroll-bottom')
    }
  })

  it('matches clear / search / font-reset without shift', () => {
    expect(matchTerminalKey(ev({ key: 'l', metaKey: true }))).toBe('clear')
    expect(matchTerminalKey(ev({ key: 'L', ctrlKey: true }))).toBe('clear')
    expect(matchTerminalKey(ev({ key: 'f', metaKey: true }))).toBe('search')
    expect(matchTerminalKey(ev({ key: '0', ctrlKey: true }))).toBe('font-reset')
  })

  it('matches font-up for both = and + (macOS WebKit reports +)', () => {
    expect(matchTerminalKey(ev({ key: '=', shiftKey: true, metaKey: true }))).toBe('font-up')
    expect(matchTerminalKey(ev({ key: '+', shiftKey: true, metaKey: true }))).toBe('font-up')
    expect(matchTerminalKey(ev({ key: '-', shiftKey: true, ctrlKey: true }))).toBe('font-down')
  })

  it('returns null without a modifier', () => {
    expect(matchTerminalKey(ev({ key: 'c', shiftKey: true }))).toBeNull()
    expect(matchTerminalKey(ev({ key: 'l' }))).toBeNull()
    expect(matchTerminalKey(ev({ key: 'Enter' }))).toBeNull()
  })

  it('returns null for plain Ctrl+C / Ctrl+V (SIGINT / paste-through) and Ctrl+K (palette)', () => {
    expect(matchTerminalKey(ev({ key: 'c', ctrlKey: true }))).toBeNull()
    expect(matchTerminalKey(ev({ key: 'v', ctrlKey: true }))).toBeNull()
    expect(matchTerminalKey(ev({ key: 'k', metaKey: true }))).toBeNull()
    expect(matchTerminalKey(ev({ key: 'k', ctrlKey: true }))).toBeNull()
  })

  it('never intercepts during IME composition', () => {
    expect(matchTerminalKey(ev({ key: 'c', shiftKey: true, metaKey: true, isComposing: true }))).toBeNull()
    expect(matchTerminalKey(ev({ key: 'f', metaKey: true, isComposing: true }))).toBeNull()
  })

  it('returns null for unrelated keys', () => {
    expect(matchTerminalKey(ev({ key: 't', metaKey: true }))).toBeNull()
    expect(matchTerminalKey(ev({ key: '1', shiftKey: true, metaKey: true }))).toBeNull()
  })
})
