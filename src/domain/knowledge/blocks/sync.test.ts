import { describe, expect, it } from 'vitest'
import {
  SYNC_GUARD_PROBE,
  extractAnchorBlock,
  extractSyncGuard,
  joinSyncGuard,
} from './sync'
import { carrierRoundTrip } from './dialectBridge'

describe('sync guard helpers (V2-E1)', () => {
  it('extracts nodeId + anchor from a well-formed guard', () => {
    const g = extractSyncGuard('<!-- hip-sync:doc_abc#评测体系设计 -->')
    expect(g).toEqual({ nodeId: 'doc_abc', anchor: '评测体系设计' })
  })

  it('rejects malformed guards', () => {
    expect(extractSyncGuard('<!-- hip-sync:doc_abc -->')).toBeNull()
    expect(extractSyncGuard('<!-- hip-sync:#anchor -->')).toBeNull()
    expect(extractSyncGuard('plain text')).toBeNull()
  })

  it('joinSyncGuard round-trips with extract', () => {
    const md = joinSyncGuard('doc_1', 'Heading Text')
    expect(extractSyncGuard(md)).toEqual({ nodeId: 'doc_1', anchor: 'Heading Text' })
  })

  it('probe matches guards only', () => {
    expect(SYNC_GUARD_PROBE.test('<!-- hip-sync:a#b -->')).toBe(true)
    expect(SYNC_GUARD_PROBE.test('a#b')).toBe(false)
  })
})

describe('extractAnchorBlock', () => {
  const body = [
    '# Title',
    '',
    '## 评测体系设计',
    '',
    '评分器策略：规则评分器 + 模型评分器。',
    '',
    '- 任务一',
    '',
  ].join('\n')

  it('matches heading anchors exactly (heading text)', () => {
    const hit = extractAnchorBlock(body, '评测体系设计')
    expect(hit?.md).toBe('## 评测体系设计')
    expect(hit?.text).toBe('评测体系设计')
  })

  it('matches body text by inclusion', () => {
    const hit = extractAnchorBlock(body, '评分器策略')
    expect(hit?.text).toContain('评分器策略')
  })

  it('returns null when anchor is missing', () => {
    expect(extractAnchorBlock(body, 'zzz-missing')).toBeNull()
    expect(extractAnchorBlock(body, '')).toBeNull()
  })
})

describe('sync carrier round-trip', () => {
  it('guard survives the carrier bridge', () => {
    const md = '<!-- hip-sync:doc_abc#评测体系设计 -->'
    const back = carrierRoundTrip(md)
    expect(extractSyncGuard(back)).toEqual({
      nodeId: 'doc_abc',
      anchor: '评测体系设计',
    })
  })

  it('sync guard coexists with wiki links', () => {
    const md = 'see [[报告]] here\n\n<!-- hip-sync:doc_abc#评分器策略 -->\n'
    const back = carrierRoundTrip(md)
    expect(back).toContain('[[报告]]')
    expect(extractSyncGuard(back)).toEqual({
      nodeId: 'doc_abc',
      anchor: '评分器策略',
    })
  })
})
