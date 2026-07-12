import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  applyPrefs,
  buildContextMenuItems,
  clearContextProviders,
  mergeByGroup,
  registerContextProvider,
} from './registry'
import type { ContextMenuBuildContext, ContextMenuItemDef, ContextProvider } from './types'

function makeCtx(overrides: Partial<ContextMenuBuildContext> = {}): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'chat',
    surface: 'chat',
    activeSessionId: null,
    sessionStatus: 'idle',
    sessionInterrupt: undefined,
    openSessionIds: [],
    copyText: vi.fn(async () => true),
    ...overrides,
  }
}

function item(
  partial: Pick<ContextMenuItemDef, 'id' | 'group'> & Partial<ContextMenuItemDef>,
): ContextMenuItemDef {
  return {
    label: partial.label ?? partial.id,
    run: partial.run ?? (() => {}),
    ...partial,
  }
}

beforeEach(() => {
  clearContextProviders()
})

describe('mergeByGroup', () => {
  it('orders by fixed group order and inserts separators between groups', () => {
    const merged = mergeByGroup([
      item({ id: 'd1', group: 'danger', label: 'Delete' }),
      item({ id: 'c1', group: 'clipboard', label: 'Copy' }),
      item({ id: 'p1', group: 'primary', label: 'Open' }),
      item({ id: 'c2', group: 'clipboard', label: 'Copy id' }),
    ])
    expect(merged.map((i) => i.id)).toEqual(['p1', 'c1', 'c2', 'd1'])
    expect(merged.find((i) => i.id === 'p1')?.separatorBefore).toBeFalsy()
    expect(merged.find((i) => i.id === 'c1')?.separatorBefore).toBe(true)
    expect(merged.find((i) => i.id === 'c2')?.separatorBefore).toBeFalsy()
    expect(merged.find((i) => i.id === 'd1')?.separatorBefore).toBe(true)
  })

  it('skips duplicate ids (first wins)', () => {
    const merged = mergeByGroup([
      item({ id: 'x', group: 'primary', label: 'First' }),
      item({ id: 'x', group: 'danger', label: 'Second' }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.label).toBe('First')
  })
})

describe('applyPrefs', () => {
  it('filters disabledIds', () => {
    const items = [
      item({ id: 'a', group: 'primary' }),
      item({ id: 'b', group: 'primary' }),
      item({ id: 'c', group: 'primary' }),
    ]
    expect(applyPrefs(items, { version: 1, disabledIds: ['b'] }).map((i) => i.id)).toEqual([
      'a',
      'c',
    ])
  })

  it('returns all when disabledIds empty', () => {
    const items = [item({ id: 'a', group: 'primary' })]
    expect(applyPrefs(items, { version: 1, disabledIds: [] })).toEqual(items)
  })
})

describe('buildContextMenuItems', () => {
  it('returns empty when no providers match', () => {
    const out = buildContextMenuItems(
      { kind: 'message', payload: { message: {} as never, isLastAssistant: false, sessionId: null } },
      makeCtx(),
      { version: 1, disabledIds: [] },
    )
    expect(out).toEqual([])
  })

  it('merges extra providers and applies disabledIds', () => {
    const provider: ContextProvider = (req) => {
      if (req.kind !== 'codeBlock') return []
      return [
        item({
          id: 'codeBlock.copy',
          group: 'clipboard',
          label: 'Copy',
          run: () => {},
        }),
        item({
          id: 'codeBlock.copyFenced',
          group: 'clipboard',
          label: 'Copy fenced',
          run: () => {},
        }),
      ]
    }
    registerContextProvider(provider)
    const all = buildContextMenuItems(
      { kind: 'codeBlock', payload: { code: 'x' } },
      makeCtx(),
      { version: 1, disabledIds: [] },
    )
    expect(all.map((i) => i.id)).toEqual(['codeBlock.copy', 'codeBlock.copyFenced'])

    const filtered = buildContextMenuItems(
      { kind: 'codeBlock', payload: { code: 'x' } },
      makeCtx(),
      { version: 1, disabledIds: ['codeBlock.copyFenced'] },
    )
    expect(filtered.map((i) => i.id)).toEqual(['codeBlock.copy'])
  })

  it('unregister removes extra provider', () => {
    const unreg = registerContextProvider(() => [
      item({ id: 'extra.1', group: 'extensions', label: 'Extra' }),
    ])
    expect(
      buildContextMenuItems(
        { kind: 'chatEmpty', payload: { sessionId: null } },
        makeCtx(),
        { version: 1, disabledIds: [] },
      ),
    ).toHaveLength(1)
    unreg()
    expect(
      buildContextMenuItems(
        { kind: 'chatEmpty', payload: { sessionId: null } },
        makeCtx(),
        { version: 1, disabledIds: [] },
      ),
    ).toHaveLength(0)
  })

  it('clearContextProviders clears extras only', () => {
    registerContextProvider(() => [item({ id: 'e', group: 'extensions' })])
    clearContextProviders()
    expect(
      buildContextMenuItems(
        { kind: 'chatEmpty', payload: { sessionId: null } },
        makeCtx(),
        { version: 1, disabledIds: [] },
      ),
    ).toHaveLength(0)
  })
})
