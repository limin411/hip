import { describe, it, expect, beforeEach } from 'vitest'
import { formatDiffAnnotationsForComposer, useDiffAnnotationStore } from './diffAnnotationStore'

describe('diffAnnotationStore', () => {
  beforeEach(() => {
    useDiffAnnotationStore.setState({ bySession: {} })
  })

  it('adds and clears annotations', () => {
    const id = useDiffAnnotationStore.getState().add('s1', {
      path: 'a.ts',
      body: '+foo',
      note: 'rename',
    })
    expect(useDiffAnnotationStore.getState().list('s1')).toHaveLength(1)
    useDiffAnnotationStore.getState().remove('s1', id)
    expect(useDiffAnnotationStore.getState().list('s1')).toHaveLength(0)
  })
})

describe('formatDiffAnnotationsForComposer', () => {
  it('returns empty for no anns', () => {
    expect(formatDiffAnnotationsForComposer([])).toBe('')
  })

  it('formats path, note, diff fence, and structured JSON', () => {
    const text = formatDiffAnnotationsForComposer([
      { id: '1', path: 'x.go', body: '+x', note: 'fix name', createdAt: 1 },
    ])
    expect(text).toContain('## Diff annotations')
    expect(text).toContain('`x.go`')
    expect(text).toContain('Note: fix name')
    expect(text).toContain('```diff')
    expect(text).toContain('+x')
    expect(text).toContain('hip.diff_annotations')
    expect(text).toContain('```json')
  })
})
