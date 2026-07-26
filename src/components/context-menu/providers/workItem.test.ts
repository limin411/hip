import { describe, it, expect, vi, beforeEach } from 'vitest'
import { workItemProvider } from './workItem'
import type { ContextMenuBuildContext } from '../types'
import { resetWorkItemDeleteDialogStore, getWorkItemDeleteDialog } from '@/components/work-items/workItemDeleteDialogStore'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(async () => {}),
}))

function makeCtx(overrides: Partial<ContextMenuBuildContext> = {}): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'tasks',
    surface: null,
    activeSessionId: null,
    sessionStatus: 'idle',
    sessionInterrupt: false,
    copyText: vi.fn(async () => true),
    ...overrides,
  }
}

beforeEach(() => {
  resetWorkItemDeleteDialogStore()
})

describe('workItemProvider', () => {
  it('returns empty for other kinds', () => {
    expect(
      workItemProvider(
        { kind: 'codeBlock', payload: { code: 'x' } },
        makeCtx(),
      ),
    ).toEqual([])
  })

  it('common open todo without links has 7 items', () => {
    const items = workItemProvider(
      {
        kind: 'workItem',
        payload: {
          itemId: '1',
          title: 'Ship',
          status: 'todo',
          archived: false,
          links: {},
        },
      },
      makeCtx(),
    )
    expect(items.map((i) => i.id).sort()).toEqual(
      [
        'workItem.open',
        'workItem.complete',
        'workItem.setInProgress',
        'workItem.cancel',
        'workItem.archive',
        'workItem.copyTitle',
        'workItem.delete',
      ].sort(),
    )
    expect(items).toHaveLength(7)
  })

  it('locks golden menu for todo + 3 links (drop cancel + setInProgress)', () => {
    const ids = workItemProvider(
      {
        kind: 'workItem',
        payload: {
          itemId: '1',
          title: 'Ship',
          status: 'todo',
          archived: false,
          links: {
            sessionId: 's1',
            knowledge: { spaceId: 'sp', docId: 'd' },
            url: 'https://example.com',
          },
        },
      },
      makeCtx(),
    ).map((i) => i.id)

    expect(ids).toHaveLength(8)
    expect(ids).toEqual(
      expect.arrayContaining([
        'workItem.open',
        'workItem.complete',
        'workItem.copyTitle',
        'workItem.delete',
        'workItem.archive',
        'workItem.openSession',
        'workItem.openKnowledge',
        'workItem.openUrl',
      ]),
    )
    expect(ids).not.toContain('workItem.cancel')
    expect(ids).not.toContain('workItem.setInProgress')
  })

  it('hides complete/setInProgress/cancel for cancelled; shows archive', () => {
    const ids = workItemProvider(
      {
        kind: 'workItem',
        payload: {
          itemId: '1',
          title: 'X',
          status: 'cancelled',
          archived: false,
          links: {},
        },
      },
      makeCtx(),
    ).map((i) => i.id)
    expect(ids.sort()).toEqual(
      ['workItem.open', 'workItem.archive', 'workItem.copyTitle', 'workItem.delete'].sort(),
    )
  })

  it('shows reopen for done; no cancel', () => {
    const ids = workItemProvider(
      {
        kind: 'workItem',
        payload: {
          itemId: '1',
          title: 'X',
          status: 'done',
          archived: false,
          links: {},
        },
      },
      makeCtx(),
    ).map((i) => i.id)
    expect(ids).toContain('workItem.reopen')
    expect(ids).not.toContain('workItem.complete')
    expect(ids).not.toContain('workItem.cancel')
  })

  it('delete opens dialog store', () => {
    const items = workItemProvider(
      {
        kind: 'workItem',
        payload: {
          itemId: 'wi_9',
          title: 'Delete me',
          status: 'todo',
          archived: false,
          links: {},
        },
      },
      makeCtx(),
    )
    items.find((i) => i.id === 'workItem.delete')!.run()
    expect(getWorkItemDeleteDialog()).toEqual({ itemId: 'wi_9', title: 'Delete me' })
  })
})
