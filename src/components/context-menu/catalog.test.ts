import { describe, it, expect, beforeEach } from 'vitest'
import { clearCatalogMeta, listCatalogItems, registerCatalogMeta } from './catalog'
import type { ContextMenuItemMeta } from './types'

beforeEach(() => {
  clearCatalogMeta()
})

describe('listCatalogItems', () => {
  it('includes static message + codeBlock meta from builtins', () => {
    const ids = listCatalogItems().map((m) => m.id)
    expect(ids).toContain('message.copy')
    expect(ids).toContain('message.quote')
    expect(ids).toContain('message.copyId')
    expect(ids).toContain('message.regenerate')
    expect(ids).toContain('session.copyDebugBundle')
    expect(ids).toContain('codeBlock.copy')
    expect(listCatalogItems('codeBlock').map((m) => m.id)).toEqual(['codeBlock.copy'])
    expect(listCatalogItems('message').every((m) => m.kind === 'message')).toBe(true)
  })

  it('lists all and filters by kind (extras + static)', () => {
    const meta: ContextMenuItemMeta[] = [
      {
        id: 'plugin.extra',
        labelKey: 'plugin.extra',
        kind: 'plugin',
        group: 'extensions',
      },
    ]
    registerCatalogMeta(meta)
    expect(listCatalogItems().map((m) => m.id)).toContain('plugin.extra')
    expect(listCatalogItems('plugin').map((m) => m.id)).toEqual(['plugin.extra'])
    expect(listCatalogItems('codeBlock').map((m) => m.id)).toEqual(['codeBlock.copy'])
  })

  it('dedupes by id on register (static wins)', () => {
    registerCatalogMeta([
      {
        id: 'message.copy',
        labelKey: 'override-should-not-apply',
        kind: 'message',
        group: 'clipboard',
      },
    ])
    const copy = listCatalogItems().find((m) => m.id === 'message.copy')
    expect(copy?.labelKey).toBe('contextMenu.message.copy')
  })

  it('unregister removes registered meta', () => {
    const before = listCatalogItems().length
    const unreg = registerCatalogMeta([
      {
        id: 'x',
        labelKey: 'x',
        kind: 'plugin',
        group: 'extensions',
      },
    ])
    expect(listCatalogItems()).toHaveLength(before + 1)
    unreg()
    expect(listCatalogItems()).toHaveLength(before)
  })

  it('clearCatalogMeta only clears extras (static catalog is never wiped)', () => {
    registerCatalogMeta([
      {
        id: 'extra.only',
        labelKey: 'extra',
        kind: 'plugin',
        group: 'extensions',
      },
    ])
    expect(listCatalogItems().some((m) => m.id === 'extra.only')).toBe(true)
    clearCatalogMeta()
    expect(listCatalogItems().some((m) => m.id === 'extra.only')).toBe(false)
    // Static message/code entries remain after clear.
    expect(listCatalogItems().map((m) => m.id)).toContain('message.copy')
    expect(listCatalogItems().map((m) => m.id)).toContain('codeBlock.copy')
  })
})
