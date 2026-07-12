import { describe, it, expect, beforeEach } from 'vitest'
import { clearCatalogMeta, listCatalogItems, registerCatalogMeta } from './catalog'
import type { ContextMenuItemMeta } from './types'

beforeEach(() => {
  clearCatalogMeta()
})

describe('listCatalogItems', () => {
  it('includes static PR surface meta (diff / checkpoint / terminal)', () => {
    const ids = listCatalogItems().map((m) => m.id)
    expect(ids).toContain('diffFile.copyPath')
    expect(ids).toContain('checkpoint.revert')
    expect(ids).toContain('terminal.restart')
    expect(ids).toContain('terminal.copySelection')
    expect(ids).toContain('terminal.paste')
    expect(listCatalogItems('message')).toEqual([])
  })

  it('lists extras and filters by kind', () => {
    const staticCount = listCatalogItems().length
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
    expect(listCatalogItems()).toHaveLength(staticCount + 3)
    expect(listCatalogItems('message').map((m) => m.id)).toEqual([
      'message.copy',
      'message.regenerate',
    ])
    expect(listCatalogItems('codeBlock').map((m) => m.id)).toEqual(['codeBlock.copy'])
    expect(listCatalogItems('diffFile').length).toBeGreaterThan(0)
  })

  it('dedupes by id on register', () => {
    const staticCount = listCatalogItems().length
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
    expect(listCatalogItems()).toHaveLength(staticCount + 1)
    expect(listCatalogItems().find((m) => m.id === 'message.copy')?.labelKey).toBe('a')
  })

  it('unregister removes registered meta', () => {
    const staticCount = listCatalogItems().length
    const unreg = registerCatalogMeta([
      {
        id: 'x',
        labelKey: 'x',
        kind: 'plugin',
        group: 'extensions',
      },
    ])
    expect(listCatalogItems()).toHaveLength(staticCount + 1)
    unreg()
    expect(listCatalogItems()).toHaveLength(staticCount)
  })

  it('clearCatalogMeta only clears extras (static catalog is never wiped)', () => {
    const staticCount = listCatalogItems().length
    expect(staticCount).toBeGreaterThan(0)
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
    expect(listCatalogItems()).toHaveLength(staticCount)
    expect(listCatalogItems().map((m) => m.id)).toContain('diffFile.copyPath')
  })
})
