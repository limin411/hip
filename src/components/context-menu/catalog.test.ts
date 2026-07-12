import { describe, it, expect, beforeEach } from 'vitest'
import { clearCatalogMeta, listCatalogItems, registerCatalogMeta } from './catalog'
import type { ContextMenuItemMeta } from './types'

beforeEach(() => {
  clearCatalogMeta()
})

describe('listCatalogItems', () => {
  it('includes static meta from message, session, and file surfaces', () => {
    const ids = listCatalogItems().map((m) => m.id)
    for (const id of [
      'message.copy', 'codeBlock.copy',
      'sessionTab.close', 'sessionHistory.open',
      'file.copyPath', 'file.openContainingFolder',
    ]) {
      expect(ids).toContain(id)
    }
  })

  it('filters by kind', () => {
    expect(listCatalogItems('codeBlock').map((m) => m.id)).toEqual(['codeBlock.copy'])
    expect(listCatalogItems('sessionTab').map((m) => m.id)).toContain('sessionTab.close')
  })

  it('lists extras and filters by kind', () => {
    registerCatalogMeta([
      { id: 'plugin.extra', labelKey: 'plugin.extra', kind: 'plugin', group: 'extensions' },
    ])
    expect(listCatalogItems('plugin').map((m) => m.id)).toEqual(['plugin.extra'])
  })

  it('dedupes by id on register (static wins)', () => {
    registerCatalogMeta([
      { id: 'message.copy', labelKey: 'override', kind: 'message', group: 'clipboard' },
    ])
    expect(listCatalogItems().find((m) => m.id === 'message.copy')?.labelKey).toBe(
      'contextMenu.message.copy',
    )
  })

  it('unregister removes registered meta only', () => {
    const before = listCatalogItems().length
    const unreg = registerCatalogMeta([
      { id: 'x', labelKey: 'x', kind: 'plugin', group: 'extensions' },
    ])
    expect(listCatalogItems()).toHaveLength(before + 1)
    unreg()
    expect(listCatalogItems()).toHaveLength(before)
  })

  it('clearCatalogMeta only clears extras', () => {
    const staticIds = listCatalogItems().map((m) => m.id)
    registerCatalogMeta([
      { id: 'extra.only', labelKey: 'extra', kind: 'plugin', group: 'extensions' },
    ])
    clearCatalogMeta()
    expect(listCatalogItems().map((m) => m.id)).toEqual(staticIds)
  })
})
