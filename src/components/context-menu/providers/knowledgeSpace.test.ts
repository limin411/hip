import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getKnowledgeSpaceDialog,
  resetKnowledgeSpaceDialogStore,
} from '@/components/knowledge/knowledgeSpaceDialogStore'
import { knowledgeSpaceProvider } from './knowledgeSpace'
import type { ContextMenuBuildContext } from '../types'

const ctx = {
  t: ((k: string) => k) as ContextMenuBuildContext['t'],
  isMac: true,
} as ContextMenuBuildContext

describe('knowledgeSpaceProvider', () => {
  beforeEach(() => {
    resetKnowledgeSpaceDialogStore()
  })

  afterEach(() => {
    resetKnowledgeSpaceDialogStore()
  })

  it('returns rename and delete items', () => {
    const items = knowledgeSpaceProvider(
      {
        kind: 'knowledgeSpace',
        payload: { spaceId: 'spc_1', name: 'Notes' },
      },
      ctx,
    )
    expect(items.map((i) => i.id)).toEqual([
      'knowledgeSpace.rename',
      'knowledgeSpace.delete',
    ])
    expect(items.find((i) => i.id === 'knowledgeSpace.delete')?.danger).toBe(true)
  })

  it('rename opens dialog store', () => {
    const items = knowledgeSpaceProvider(
      {
        kind: 'knowledgeSpace',
        payload: { spaceId: 'spc_1', name: 'Notes', icon: '📚' },
      },
      ctx,
    )
    items.find((i) => i.id === 'knowledgeSpace.rename')!.run()
    expect(getKnowledgeSpaceDialog()).toEqual({
      kind: 'rename',
      spaceId: 'spc_1',
      name: 'Notes',
      icon: '📚',
    })
  })

  it('delete opens dialog store', () => {
    const items = knowledgeSpaceProvider(
      {
        kind: 'knowledgeSpace',
        payload: { spaceId: 'spc_1', name: 'Notes' },
      },
      ctx,
    )
    items.find((i) => i.id === 'knowledgeSpace.delete')!.run()
    expect(getKnowledgeSpaceDialog()).toEqual({
      kind: 'delete',
      spaceId: 'spc_1',
      name: 'Notes',
    })
  })
})
