import { describe, it, expect, beforeEach } from 'vitest'
import { clearCatalogMeta, listCatalogItems, registerCatalogMeta } from './catalog'
import type { ContextMenuItemMeta } from './types'

beforeEach(() => {
  clearCatalogMeta()
})

describe('listCatalogItems', () => {
  it('returns empty when catalog is empty', () => {
    expect(listCatalogItems()).toEqual([])
    expect(listCatalogItems('message')).toEqual([])
  })

  it('lists all and filters by kind', () => {
    const meta: ContextMenuItemMeta[] = [
      {
        id: 'message.copy',
        labelKey: 'contextMenu.message.copy',
        kind: 'message',
        group: 'clipboard',
      },
      {
        id: 'codeBlock.copy',
        labelKey: 'contextMenu.codeBlock.copy',
        kind: 'codeBlock',
        group: 'clipboard',
      },
      {
        id: 'message.regenerate',
        labelKey: 'contextMenu.message.regenerate',
        kind: 'message',
        group: 'primary',
      },
    ]
    registerCatalogMeta(meta)
    expect(listCatalogItems().map((m) => m.id)).toEqual([
      'message.copy',
      'codeBlock.copy',
      'message.regenerate',
    ])
    expect(listCatalogItems('message').map((m) => m.id)).toEqual([
      'message.copy',
      'message.regenerate',
    ])
    expect(listCatalogItems('codeBlock').map((m) => m.id)).toEqual(['codeBlock.copy'])
  })

  it('dedupes by id on register', () => {
    registerCatalogMeta([
      {
        id: 'message.copy',
        labelKey: 'a',
        kind: 'message',
        group: 'clipboard',
      },
    ])
    registerCatalogMeta([
      {
        id: 'message.copy',
        labelKey: 'b',
        kind: 'message',
        group: 'clipboard',
      },
    ])
    expect(listCatalogItems()).toHaveLength(1)
    expect(listCatalogItems()[0]?.labelKey).toBe('a')
  })

  it('unregister removes registered meta', () => {
    const unreg = registerCatalogMeta([
      {
        id: 'x',
        labelKey: 'x',
        kind: 'plugin',
        group: 'extensions',
      },
    ])
    expect(listCatalogItems()).toHaveLength(1)
    unreg()
    expect(listCatalogItems()).toHaveLength(0)
  })
})
