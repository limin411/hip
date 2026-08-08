import { describe, it, expect, vi } from 'vitest'
import { knowledgeRecentProvider } from './knowledgeRecent'
import type { ContextMenuBuildContext } from '../types'

const ctx = {
  t: ((k: string) => k) as ContextMenuBuildContext['t'],
  isMac: true,
} as ContextMenuBuildContext

describe('knowledgeRecentProvider (V2-N1)', () => {
  it('returns a single danger remove item that calls onRemove', () => {
    const onRemove = vi.fn()
    const items = knowledgeRecentProvider(
      {
        kind: 'knowledgeRecent',
        payload: { spaceId: 'sp1', docId: 'doc_x', onRemove },
      },
      ctx,
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('knowledgeRecent.remove')
    expect(items[0]?.danger).toBe(true)
    items[0]?.run()
    expect(onRemove).toHaveBeenCalled()
  })

  it('returns [] for other kinds', () => {
    expect(
      knowledgeRecentProvider(
        { kind: 'knowledgeNode', payload: {} as never },
        ctx,
      ),
    ).toEqual([])
  })
})
