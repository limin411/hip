// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import {
  catalogKinds,
  ContextMenuSettings,
  defaultItemsForKind,
  itemsForKind,
  orderCatalogMeta,
} from './ContextMenuSettings'
import { CONTEXT_MENU_PREFS_KEY, loadPrefs } from './prefs'
import { listCatalogItems } from './catalog'
import { sortMetaByGroup } from './groupOrder'
import type { ContextMenuItemMeta } from './types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('orderCatalogMeta', () => {
  const sample: ContextMenuItemMeta[] = [
    { id: 'a', labelKey: 'a', kind: 'message', group: 'primary' },
    { id: 'b', labelKey: 'b', kind: 'message', group: 'primary' },
    { id: 'c', labelKey: 'c', kind: 'message', group: 'primary' },
  ]

  it('returns catalog order when no preference', () => {
    expect(orderCatalogMeta(sample).map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('applies preferred order and appends missing', () => {
    expect(orderCatalogMeta(sample, ['c', 'a']).map((m) => m.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('defaultItemsForKind / group baseline', () => {
  it('defaults to sortMetaByGroup (mergeByGroup rank), not raw catalog file order', () => {
    // Even if listCatalogItems were out of group order, defaultItemsForKind sorts by group.
    const raw = listCatalogItems('message')
    const baseline = defaultItemsForKind('message')
    expect(baseline.map((m) => m.id)).toEqual(sortMetaByGroup(raw).map((m) => m.id))
    expect(baseline.map((m) => m.id)).toEqual([
      'message.regenerate',
      'message.quote',
      'message.copy',
      'message.copyId',
      'session.exportDebugBundle',
    ])
  })

  it('for every catalog kind, default Settings order equals group-sorted catalog', () => {
    for (const kind of catalogKinds()) {
      const expected = sortMetaByGroup(listCatalogItems(kind)).map((m) => m.id)
      expect(defaultItemsForKind(kind).map((m) => m.id)).toEqual(expected)
      expect(itemsForKind(kind).map((m) => m.id)).toEqual(expected)
    }
  })
})

describe('catalogKinds', () => {
  it('returns only kinds present in the static catalog', () => {
    const kinds = catalogKinds()
    expect(kinds.length).toBeGreaterThan(0)
    const fromCatalog = new Set(listCatalogItems().map((m) => m.kind))
    for (const k of kinds) {
      expect(fromCatalog.has(k)).toBe(true)
    }
    expect(kinds).toEqual(expect.arrayContaining(['message', 'fileEntry', 'sessionHistory']))
  })

  it('includes shipped knowledge and terminal-management kinds in section order', () => {
    const kinds = catalogKinds()
    expect(kinds).toEqual(
      expect.arrayContaining([
        'managedTerminal',
        'sftpEntry',
        'termFsEntry',
        'knowledgeNode',
        'knowledgeTree',
      ]),
    )
    // 文档管理 v2：空间级右键菜单已删除
    expect(kinds).not.toContain('knowledgeSpace')
    // Section order: managedTerminal after terminal; knowledge kinds after plugin.
    expect(kinds.indexOf('managedTerminal')).toBeGreaterThan(kinds.indexOf('terminal'))
    expect(kinds.indexOf('knowledgeNode')).toBeGreaterThan(kinds.indexOf('plugin'))
  })
})

function openContextMenuSettingsDialog() {
  fireEvent.click(screen.getByTestId('context-menu-settings-open'))
  expect(screen.getByTestId('context-menu-settings-dialog')).toBeInTheDocument()
}

describe('ContextMenuSettings', () => {
  it('renders a compact row; catalog items only appear after opening the dialog', () => {
    render(<ContextMenuSettings />)
    expect(screen.getByTestId('context-menu-settings')).toBeInTheDocument()
    expect(screen.getByTestId('context-menu-settings-open')).toBeInTheDocument()
    expect(screen.getAllByText('settings.contextMenu.title').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('context-menu-settings-dialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('context-menu-settings-item-message.copy')).not.toBeInTheDocument()

    openContextMenuSettingsDialog()

    const catalog = listCatalogItems()
    expect(catalog.length).toBeGreaterThan(0)
    for (const item of catalog) {
      expect(screen.getByTestId(`context-menu-settings-item-${item.id}`)).toBeInTheDocument()
    }
  })

  it('shows message items in mergeByGroup order by default', () => {
    render(<ContextMenuSettings />)
    openContextMenuSettingsDialog()
    const section = screen.getByTestId('context-menu-settings-kind-message')
    const rows = within(section).getAllByTestId(/context-menu-settings-item-/)
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'context-menu-settings-item-message.regenerate',
      'context-menu-settings-item-message.quote',
      'context-menu-settings-item-message.copy',
      'context-menu-settings-item-message.copyId',
      'context-menu-settings-item-session.exportDebugBundle',
    ])
  })

  it('hides an item via checkbox and persists disabledIds', () => {
    render(<ContextMenuSettings />)
    openContextMenuSettingsDialog()
    const id = 'message.copy'
    const checkbox = screen.getByTestId(`context-menu-settings-visible-${id}`)
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()
    expect(loadPrefs().disabledIds).toContain(id)
    expect(localStorage.getItem(CONTEXT_MENU_PREFS_KEY)).toContain(id)
  })

  it('sequential hides both land in disabledIds (functional setPrefs)', () => {
    render(<ContextMenuSettings />)
    openContextMenuSettingsDialog()
    fireEvent.click(screen.getByTestId('context-menu-settings-visible-message.copy'))
    fireEvent.click(screen.getByTestId('context-menu-settings-visible-message.quote'))
    const ids = loadPrefs().disabledIds
    expect(ids).toEqual(expect.arrayContaining(['message.copy', 'message.quote']))
    expect(ids).toHaveLength(2)
  })

  it('reorders from group baseline and persists orderByKind as a single adjacent swap', () => {
    render(<ContextMenuSettings />)
    openContextMenuSettingsDialog()
    const kind = 'message'
    const section = screen.getByTestId(`context-menu-settings-kind-${kind}`)
    const baseline = defaultItemsForKind(kind).map((m) => m.id)
    expect(baseline.length).toBeGreaterThanOrEqual(2)
    const firstId = baseline[0]!
    const secondId = baseline[1]!

    fireEvent.click(within(section).getByTestId(`context-menu-settings-down-${firstId}`))

    const expected = baseline.slice()
    expected[0] = secondId
    expected[1] = firstId
    expect(loadPrefs().orderByKind?.[kind]).toEqual(expected)

    const rows = within(section).getAllByTestId(/context-menu-settings-item-/)
    expect(rows[0]).toHaveAttribute('data-testid', `context-menu-settings-item-${secondId}`)
    expect(rows[1]).toHaveAttribute('data-testid', `context-menu-settings-item-${firstId}`)
  })

  it('reset restores defaults and clears storage', () => {
    render(<ContextMenuSettings />)
    openContextMenuSettingsDialog()
    fireEvent.click(screen.getByTestId('context-menu-settings-visible-message.copy'))
    expect(loadPrefs().disabledIds).toContain('message.copy')

    fireEvent.click(screen.getByTestId('context-menu-settings-reset'))
    expect(loadPrefs()).toEqual({ version: 1, disabledIds: [] })
    expect(localStorage.getItem(CONTEXT_MENU_PREFS_KEY)).toBeNull()
    expect(screen.getByTestId('context-menu-settings-visible-message.copy')).toBeChecked()
  })
})
