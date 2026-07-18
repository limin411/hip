import { describe, expect, it } from 'vitest'
import { formatAnnotationsStructured, messageHasAnnotationInject } from './annotationInject'

describe('annotationInject (P3 G2)', () => {
  it('emits parseable JSON fence', () => {
    const text = formatAnnotationsStructured([
      { id: '1', path: 'a.ts', body: '-x\n+y', note: 'rename', createdAt: 1 },
    ])
    expect(messageHasAnnotationInject(text)).toBe(true)
    const m = text.match(/```json\n([\s\S]*?)\n```/)
    expect(m).toBeTruthy()
    const json = JSON.parse(m![1])
    expect(json.type).toBe('hip.diff_annotations')
    expect(json.annotations[0].path).toBe('a.ts')
    expect(json.annotations[0].note).toBe('rename')
  })

  it('returns empty for no annotations', () => {
    expect(formatAnnotationsStructured([])).toBe('')
  })
})
