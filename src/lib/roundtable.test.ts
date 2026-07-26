import { describe, it, expect } from 'vitest'
import {
  ROUNDTABLE_MARKER,
  ROUNDTABLE_PERSONAS,
  ROUNDTABLE_ROUNDS_MAX,
  ROUNDTABLE_ROUNDS_MIN,
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
    expect(out).toContain('chair and final decision-maker')
    expect(out).toContain('MULTI-ROUND DIALOGUE')
    expect(out).toContain('Stage conclusion')
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

  it('zh-CN frame includes multi-round dialogue + hip as chair', () => {
    const f = roundtableFrame('zh-CN')
    expect(f).toContain('主持人兼最终决策者')
    expect(f).toContain('多轮讨论')
    expect(f).toContain('阶段性结论')
    expect(f).toContain('计划回合数')
    expect(f).toContain('战略家')
    expect(f).toContain('怀疑论者')
  })

  it('has five personas and round bounds', () => {
    expect(ROUNDTABLE_PERSONAS).toHaveLength(5)
    expect(ROUNDTABLE_ROUNDS_MIN).toBe(2)
    expect(ROUNDTABLE_ROUNDS_MAX).toBe(4)
    expect(roundtableFrame('en')).toContain(String(ROUNDTABLE_ROUNDS_MIN))
    expect(roundtableFrame('en')).toContain(String(ROUNDTABLE_ROUNDS_MAX))
  })
})
