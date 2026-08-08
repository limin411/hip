import { describe, expect, it } from 'vitest'
import { expandTemplateVariables, todayStamp } from './templateVars'

const NOW = new Date(2026, 7, 8) // 2026-08-08 local

describe('todayStamp', () => {
  it('formats YYYY-MM-DD with zero padding', () => {
    expect(todayStamp(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(todayStamp(NOW)).toBe('2026-08-08')
    expect(todayStamp(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('expandTemplateVariables (V2-E1 T4.10)', () => {
  it('replaces {{date}} with today and {{title}} with the doc title', () => {
    const out = expandTemplateVariables('# {{title}}\n\n创建于 {{date}}', {
      title: '智能体报告',
      now: NOW,
    })
    expect(out).toBe('# 智能体报告\n\n创建于 2026-08-08')
  })

  it('tolerates whitespace inside braces', () => {
    const out = expandTemplateVariables('{{ date }} / {{  title  }}', {
      title: 'T',
      now: NOW,
    })
    expect(out).toBe('2026-08-08 / T')
  })

  it('leaves unknown variables untouched ({{tags}} etc.)', () => {
    const out = expandTemplateVariables('{{tags}} {{foo}} {{date}}', {
      title: 'T',
      now: NOW,
    })
    expect(out).toBe('{{tags}} {{foo}} 2026-08-08')
  })

  it('empty body stays empty', () => {
    expect(expandTemplateVariables('', { title: 'T', now: NOW })).toBe('')
  })
})
