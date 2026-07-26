import { describe, it, expect } from 'vitest'
import {
  ROUNDTABLE_MARKER,
  ROUNDTABLE_PERSONAS,
  buildRoundtableOutbound,
  isRoundtableMessage,
  resolveRoundtableLang,
  stripRoundtableFrame,
  roundtableFrame,
} from './roundtable'

describe('roundtable', () => {
  it('resolveRoundtableLang maps UI locales', () => {
    expect(resolveRoundtableLang('en')).toBe('en')
    expect(resolveRoundtableLang('zh-CN')).toBe('zh-CN')
    expect(resolveRoundtableLang('zh-TW')).toBe('zh-TW')
    expect(resolveRoundtableLang('ja-JP')).toBe('ja')
    expect(resolveRoundtableLang('ko')).toBe('ko')
    expect(resolveRoundtableLang(undefined)).toBe('en')
  })

  it('buildRoundtableOutbound wraps user text with marker and frame', () => {
    const out = buildRoundtableOutbound('Should we rewrite the API?', 'en')
    expect(out.startsWith(ROUNDTABLE_MARKER)).toBe(true)
    expect(out).toContain('You own the routing decision')
    expect(out).toContain('Should we rewrite the API?')
    expect(isRoundtableMessage(out)).toBe(true)
  })

  it('buildRoundtableOutbound is a no-op for empty / whitespace', () => {
    expect(buildRoundtableOutbound('  ', 'en')).toBe('')
    expect(buildRoundtableOutbound('', 'zh-CN')).toBe('')
  })

  it('stripRoundtableFrame returns original user text', () => {
    const user = 'Compare SQLite vs Postgres for hip'
    const wire = buildRoundtableOutbound(user, 'zh-CN')
    expect(stripRoundtableFrame(wire)).toBe(user)
    expect(stripRoundtableFrame('plain hello')).toBe('plain hello')
  })

  it('zh-CN frame includes routing + advisors', () => {
    const f = roundtableFrame('zh-CN')
    expect(f).toContain('路由裁决权')
    expect(f).toContain('战略家')
    expect(f).toContain('怀疑论者')
  })

  it('has five personas', () => {
    expect(ROUNDTABLE_PERSONAS).toHaveLength(5)
  })
})
