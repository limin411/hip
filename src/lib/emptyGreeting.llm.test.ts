// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  validateLlmGreeting,
  llmGreetingCacheKey,
  readLlmGreetingCache,
  writeLlmGreetingCache,
  sanitizeSessionTitlesForGreeting,
  sanitizeMemoryHintsForGreeting,
  memoryHintsFingerprint,
  buildGenerateContext,
} from './emptyGreeting.llm'
import type { EmptyGreetingPick } from './emptyGreeting'
import type { MemoryItem } from '@hip/protocol'

function mem(partial: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'title' | 'content' | 'kind'>): MemoryItem {
  return {
    scope: 'global',
    confidence: 0.9,
    status: 'active',
    source: 'user',
    tags: [],
    createdAt: 1,
    updatedAt: 2,
    useCount: 0,
    pinned: false,
    ...partial,
  }
}

describe('validateLlmGreeting', () => {
  it('accepts short clean pairs', () => {
    expect(validateLlmGreeting({ title: 'Hello', sub: 'Ready?' })).toEqual({
      title: 'Hello',
      sub: 'Ready?',
    })
  })

  it('rejects overlong title', () => {
    expect(
      validateLlmGreeting({ title: 'x'.repeat(41), sub: 'ok' }),
    ).toBeNull()
  })

  it('rejects empty', () => {
    expect(validateLlmGreeting({ title: '  ', sub: 'ok' })).toBeNull()
  })
})

describe('llm greeting cache', () => {
  beforeEach(() => {
    try {
      sessionStorage.removeItem('hip-empty-greeting-llm-cache')
    } catch {
      // ignore
    }
  })

  it('round-trips cache entries and respects TTL', () => {
    const key = llmGreetingCacheKey({
      timeBucket: '2026-7-19@23|sunday-late',
      language: 'en',
      region: 'US',
      surface: 'chat',
      tier: 'weekEdge',
      timeOfDay: 'lateNight',
      modelKey: 'openai/gpt-4o',
    })
    const now = Date.now()
    writeLlmGreetingCache(key, { title: 'Hi', sub: 'There' }, { ttlMs: 1_000, nowMs: now })
    expect(readLlmGreetingCache(key, now)).toEqual({ title: 'Hi', sub: 'There' })
    expect(readLlmGreetingCache(key, now + 2_000)).toBeNull()
  })
})

describe('sanitizeSessionTitlesForGreeting', () => {
  it('drops placeholders and paths', () => {
    expect(
      sanitizeSessionTitlesForGreeting([
        '新对话',
        '/Users/me/secret',
        'Fix the login flow',
        'New conversation',
        'Another task',
      ]),
    ).toEqual(['Fix the login flow', 'Another task'])
  })
})

describe('buildGenerateContext', () => {
  it('maps holiday id and recent titles', () => {
    const pick: EmptyGreetingPick = {
      id: 'holiday:cn-national-day',
      tier: 'holiday',
      titleKey: 'x',
      subKey: 'y',
      region: 'CN',
      timeOfDay: 'morning',
      localHour: 9,
      weekday: 3,
      weekEdge: 'none',
    }
    const ctx = buildGenerateContext({
      pick,
      baseTitle: '国庆快乐',
      baseSub: '庆祝一下',
      language: 'zh-CN',
      surface: 'chat',
      recentSessionTitles: ['修 bug', '新对话'],
      memoryHints: ['偏好: 简洁回复'],
    })
    expect(ctx.holidayId).toBe('cn-national-day')
    expect(ctx.recentSessionTitles).toEqual(['修 bug'])
    expect(ctx.tier).toBe('holiday')
    expect(ctx.memoryHints).toEqual(['偏好: 简洁回复'])
  })
})

describe('sanitizeMemoryHintsForGreeting', () => {
  it('prefers pinned preferences and drops secret-looking text', () => {
    const hints = sanitizeMemoryHintsForGreeting([
      mem({
        id: '1',
        kind: 'preference',
        title: 'API key',
        content: 'sk-abc secret token',
        pinned: true,
      }),
      mem({
        id: '2',
        kind: 'preference',
        title: '语气',
        content: '喜欢简短直接的中文',
        pinned: true,
        lastUsedAt: 100,
      }),
      mem({
        id: '3',
        kind: 'lesson',
        title: '测试习惯',
        content: '改完先跑 vitest',
        lastUsedAt: 50,
      }),
      mem({
        id: '4',
        kind: 'convention',
        title: '命名',
        content: '用 camelCase',
      }),
    ])
    expect(hints.some((h) => /sk-|secret|token/i.test(h))).toBe(false)
    expect(hints[0]).toMatch(/语气|简短/)
    expect(hints).toHaveLength(2) // preference + lesson; convention excluded
  })

  it('fingerprints are stable for same hints', () => {
    const a = memoryHintsFingerprint(['a', 'b'])
    const b = memoryHintsFingerprint(['a', 'b'])
    const c = memoryHintsFingerprint(['a', 'c'])
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('llmGreetingCacheKey memory fp', () => {
  it('changes when memory fingerprint or time bucket changes', () => {
    const base = {
      timeBucket: '2026-7-19@23|sunday-late',
      language: 'en',
      region: 'US',
      surface: 'chat' as const,
      tier: 'weekEdge',
      timeOfDay: 'lateNight',
      modelKey: 'openai/gpt-4o',
    }
    const k1 = llmGreetingCacheKey({ ...base, memoryFp: 'aaa' })
    const k2 = llmGreetingCacheKey({ ...base, memoryFp: 'bbb' })
    const k3 = llmGreetingCacheKey({
      ...base,
      timeBucket: '2026-7-20@0|monday-early',
      timeOfDay: 'lateNight',
      memoryFp: 'aaa',
    })
    expect(k1).not.toBe(k2)
    expect(k1).not.toBe(k3)
  })
})
