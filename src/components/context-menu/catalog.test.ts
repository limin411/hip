import { describe, it, expect, beforeEach } from 'vitest'
import { clearCatalogMeta, listCatalogItems, registerCatalogMeta } from './catalog'

beforeEach(() => {
  clearCatalogMeta()
})

describe('listCatalogItems', () => {
  it('includes static meta from message, session, file, and settings list surfaces', () => {
    const ids = listCatalogItems().map((m) => m.id)
    for (const id of [
      'message.copy', 'codeBlock.copy',
      'sessionHistory.open', 'sessionHistory.delete',
      'file.copyPath', 'file.openContainingFolder',
      'agentConfig.edit', 'skillConfig.view', 'mcpServer.edit', 'plugin.uninstall',
    ]) {
      expect(ids).toContain(id)
    }
  })

  it('filters by kind', () => {
    expect(listCatalogItems('codeBlock').map((m) => m.id)).toEqual(['codeBlock.copy'])
    const historyIds = listCatalogItems('sessionHistory').map((m) => m.id)
    expect(historyIds).toContain('sessionHistory.open')
    expect(historyIds).toContain('sessionHistory.delete')
    expect(listCatalogItems('agentConfig').map((m) => m.id)).toEqual([
      'agentConfig.edit',
      'agentConfig.delete',
    ])
    expect(listCatalogItems('plugin').map((m) => m.id)).toEqual([
      'plugin.view',
      'plugin.uninstall',
    ])
  })

  it('lists extras and filters by kind', () => {
    registerCatalogMeta([
      { id: 'plugin.extra', labelKey: 'plugin.extra', kind: 'plugin', group: 'extensions' },
    ])
    expect(listCatalogItems('plugin').map((m) => m.id)).toEqual([
      'plugin.view',
      'plugin.uninstall',
      'plugin.extra',
    ])
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
