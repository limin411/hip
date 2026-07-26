import { describe, it, expect } from 'vitest'
import {
  parseRoundtableSections,
  looksLikeRoundtableTranscript,
  deriveRoundtableStatusKey,
} from './roundtableSections'

const sample = `*Convening the roundtable…*

## Meeting plan
- Rounds planned: 2
- Why: forks

## Round 1 — options
**Strategist:** Go A.

### Stage conclusion (hip)
- **Agreed:**
- A vs B

## Round 2 — cost
**Operator:** Phase it.

### Stage conclusion (hip)
- **Agreed:**
- phased

## Decision (hip)
Ship A phased.

## Next steps
1. spike
`

describe('roundtableSections', () => {
  it('detects transcript', () => {
    expect(looksLikeRoundtableTranscript(sample)).toBe(true)
    expect(looksLikeRoundtableTranscript('hello')).toBe(false)
  })

  it('parses plan, rounds, stages, decision', () => {
    const secs = parseRoundtableSections(sample)
    expect(secs.some((s) => s.kind === 'plan')).toBe(true)
    expect(secs.filter((s) => s.kind === 'round')).toHaveLength(2)
    expect(secs.filter((s) => s.kind === 'stage')).toHaveLength(2)
    expect(secs.some((s) => s.kind === 'decision')).toBe(true)
  })

  it('deriveRoundtableStatusKey tracks phase', () => {
    expect(deriveRoundtableStatusKey('', true)).toBe('routing')
    expect(deriveRoundtableStatusKey('## Meeting plan\n- Rounds planned: 2\n', true)).toBe(
      'planning',
    )
    expect(deriveRoundtableStatusKey('## Round 1 — options\n**Strategist:** x\n', true)).toBe(
      'round',
    )
    expect(deriveRoundtableStatusKey(sample, false)).toBe('done')
  })
})
