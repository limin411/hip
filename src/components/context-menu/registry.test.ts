import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  applyPrefs,
  buildContextMenuItems,
  clearContextProviders,
  mergeByGroup,
  registerContextProvider,
} from './registry'
import { sortMetaByGroup } from './groupOrder'
import type {
  ContextMenuBuildContext,
  ContextMenuItemDef,
  ContextMenuItemMeta,
  ContextProvider,
} from './types'

function makeCtx(overrides: Partial<ContextMenuBuildContext> = {}): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'chat',
    surface: 'chat',
    activeSessionId: null,
    sessionStatus: 'idle',
    sessionInterrupt: false,
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

describe('sortMetaByGroup', () => {
  it('orders meta by GROUP_ORDER ranks (stable within group)', () => {
    const meta: ContextMenuItemMeta[] = [
      { id: 'd', labelKey: 'd', kind: 'message', group: 'debug' },
      { id: 'c', labelKey: 'c', kind: 'message', group: 'clipboard' },
      { id: 'p', labelKey: 'p', kind: 'message', group: 'primary' },
      { id: 'c2', labelKey: 'c2', kind: 'message', group: 'clipboard' },
    ]
    expect(sortMetaByGroup(meta).map((m) => m.id)).toEqual(['p', 'c', 'c2', 'd'])
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

  it('returns all when disabledIds empty and strips leading separator', () => {
    const items = [
      item({ id: 'a', group: 'primary', separatorBefore: true }),
      item({ id: 'b', group: 'primary' }),
    ]
    const out = applyPrefs(items, { version: 1, disabledIds: [] })
    expect(out.map((i) => i.id)).toEqual(['a', 'b'])
    expect(out[0]?.separatorBefore).toBeFalsy()
  })

  it('does not leave a leading separator when the first group is fully disabled', () => {
    const merged = mergeByGroup([
      item({ id: 'p1', group: 'primary', label: 'Open' }),
      item({ id: 'c1', group: 'clipboard', label: 'Copy' }),
      item({ id: 'd1', group: 'danger', label: 'Delete' }),
    ])
    expect(merged.find((i) => i.id === 'c1')?.separatorBefore).toBe(true)

    const filtered = applyPrefs(merged, { version: 1, disabledIds: ['p1'] })
    expect(filtered.map((i) => i.id)).toEqual(['c1', 'd1'])
    expect(filtered[0]?.separatorBefore).toBeFalsy()
    expect(filtered.find((i) => i.id === 'd1')?.separatorBefore).toBe(true)
  })

  it('reorders via orderByKind for the given kind', () => {
    const items = [
      item({ id: 'message.copy', group: 'clipboard' }),
      item({ id: 'message.quote', group: 'edit' }),
      item({ id: 'message.copyId', group: 'debug' }),
    ]
    const out = applyPrefs(
      items,
      {
        version: 1,
        disabledIds: [],
        orderByKind: {
          message: ['message.copyId', 'message.copy', 'message.quote'],
        },
      },
      'message',
    )
    expect(out.map((i) => i.id)).toEqual([
      'message.copyId',
      'message.copy',
      'message.quote',
    ])
  })

  it('ignores orderByKind for other kinds', () => {
    const items = [
      item({ id: 'codeBlock.copy', group: 'clipboard' }),
      item({ id: 'codeBlock.extra', group: 'clipboard' }),
    ]
    const out = applyPrefs(
      items,
      {
        version: 1,
        disabledIds: [],
        orderByKind: {
          message: ['message.copy'],
          codeBlock: ['codeBlock.extra', 'codeBlock.copy'],
        },
      },
      'message',
    )
    expect(out.map((i) => i.id)).toEqual(['codeBlock.copy', 'codeBlock.extra'])
  })

  it('filters then reorders; unknown order ids are skipped', () => {
    const items = [
      item({ id: 'a', group: 'primary' }),
      item({ id: 'b', group: 'primary' }),
      item({ id: 'c', group: 'primary' }),
    ]
    const out = applyPrefs(
      items,
      {
        version: 1,
        disabledIds: ['b'],
        orderByKind: { message: ['missing', 'c', 'a', 'b'] },
      },
      'message',
    )
    expect(out.map((i) => i.id)).toEqual(['c', 'a'])
  })

  it('appends items not listed in orderByKind after ordered ones', () => {
    const items = [
      item({ id: 'a', group: 'primary' }),
      item({ id: 'b', group: 'primary' }),
      item({ id: 'c', group: 'primary' }),
    ]
    const out = applyPrefs(
      items,
      { version: 1, disabledIds: [], orderByKind: { message: ['c'] } },
      'message',
    )
    expect(out.map((i) => i.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('buildContextMenuItems', () => {
  it('returns empty when no providers match the kind', () => {
    const out = buildContextMenuItems(
      { kind: 'chatEmpty', payload: { sessionId: null } },
      makeCtx(),
      { version: 1, disabledIds: [] },
    )
    expect(out).toEqual([])
  })

  it('includes builtin message provider items', () => {
    const out = buildContextMenuItems(
      {
        kind: 'message',
        payload: {
          message: { id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as never,
          isLastAssistant: false,
          sessionId: null,
        },
      },
      makeCtx({ activeSessionId: null }),
      { version: 1, disabledIds: [] },
    )
    expect(out.map((i) => i.id)).toEqual(
      expect.arrayContaining(['message.copy', 'message.quote', 'message.copyId']),
    )
  })

  it('includes builtin codeBlock provider items', () => {
    const out = buildContextMenuItems(
      { kind: 'codeBlock', payload: { code: 'x' } },
      makeCtx(),
      { version: 1, disabledIds: [] },
    )
    expect(out.map((i) => i.id)).toEqual(['codeBlock.copy'])
  })

  it('includes builtin sessionHistory items', () => {
    const out = buildContextMenuItems(
      {
        kind: 'sessionHistory',
        payload: { sessionId: 's1', title: 'T', surface: 'chat' },
      },
      makeCtx(),
      { version: 1, disabledIds: [] },
    )
    expect(out.map((i) => i.id)).toEqual(
      expect.arrayContaining(['sessionHistory.open', 'sessionHistory.rename', 'sessionHistory.delete']),
    )
  })

  it('includes builtin filePreview / toolCall / subAgent providers', () => {
    const preview = buildContextMenuItems(
      {
        kind: 'filePreview',
        payload: {
          path: '/p/a.ts',
          content: 'x',
          mimeType: 'text/plain',
          cwd: '/p',
        },
      },
      makeCtx(),
      { version: 1, disabledIds: [] },
    )
    expect(preview.map((i) => i.id)).toContain('filePreview.copyPath')
    expect(preview.map((i) => i.id)).toContain('filePreview.openContainingFolder')

    const tool = buildContextMenuItems(
      {
        kind: 'toolCall',
        payload: {
          tool: {
            callId: 'c1',
            agentId: 'a1',
            name: 'read_file',
            input: '{}',
            status: 'finished',
            seq: 1,
          },
        },
      },
      makeCtx(),
      { version: 1, disabledIds: [] },
    )
    expect(tool.map((i) => i.id)).toContain('toolCall.copyInput')

    const sub = buildContextMenuItems(
      {
        kind: 'subAgent',
        payload: {
          agent: {
            agentId: 'w1',
            role: 'subagent',
            reasoning: '',
            tools: [],
            status: 'done',
            output: 'ok',
            elapsedMs: 0,
          },
        },
      },
      makeCtx(),
      { version: 1, disabledIds: [] },
    )
    expect(sub.map((i) => i.id)).toContain('subAgent.copyId')
  })

  it('merges extra providers and applies disabledIds', () => {
    const provider: ContextProvider = (req) => {
      if (req.kind !== 'codeBlock') return []
      return [
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

  it('clearContextProviders clears extras only (builtins remain)', () => {
    registerContextProvider(() => [item({ id: 'e', group: 'extensions' })])
    clearContextProviders()
    expect(
      buildContextMenuItems(
        { kind: 'chatEmpty', payload: { sessionId: null } },
        makeCtx(),
        { version: 1, disabledIds: [] },
      ),
    ).toHaveLength(0)
    // Builtin codeBlock still works after clear.
    expect(
      buildContextMenuItems(
        { kind: 'codeBlock', payload: { code: 'x' } },
        makeCtx(),
        { version: 1, disabledIds: [] },
      ).map((i) => i.id),
    ).toEqual(['codeBlock.copy'])
    // session builtins still work
    expect(
      buildContextMenuItems(
        {
          kind: 'sessionHistory',
          payload: { sessionId: 's1', title: 'T', surface: 'chat' },
        },
        makeCtx(),
        { version: 1, disabledIds: [] },
      ).map((i) => i.id),
    ).toEqual(['sessionHistory.open', 'sessionHistory.rename', 'sessionHistory.delete'])
  })

  it('includes builtin fileEntry items when payload has path', () => {
    const out = buildContextMenuItems(
      {
        kind: 'fileEntry',
        payload: {
          path: 'src/a.ts',
          name: 'a.ts',
          isDir: false,
          scopeId: 's1',
          cwd: '/proj',
          isDraft: false,
        },
      },
      makeCtx(),
      { version: 1, disabledIds: [] },
    )
    expect(out.map((i) => i.id)).toEqual(
      expect.arrayContaining(['file.copyPath', 'file.openContainingFolder']),
    )
  })
})
