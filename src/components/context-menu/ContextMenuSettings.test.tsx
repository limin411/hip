// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import {
  catalogKinds,
  ContextMenuSettings,
  orderCatalogMeta,
} from './ContextMenuSettings'
import { CONTEXT_MENU_PREFS_KEY, loadPrefs } from './prefs'
import { listCatalogItems } from './catalog'
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

describe('catalogKinds', () => {
  it('returns only kinds present in the static catalog', () => {
    const kinds = catalogKinds()
    expect(kinds.length).toBeGreaterThan(0)
    const fromCatalog = new Set(listCatalogItems().map((m) => m.kind))
    for (const k of kinds) {
      expect(fromCatalog.has(k)).toBe(true)
    }
    expect(kinds).toEqual(expect.arrayContaining(['message', 'fileEntry', 'sessionTab']))
  })
})

describe('ContextMenuSettings', () => {
  it('renders catalog sections and items from listCatalogItems only', () => {
    render(<ContextMenuSettings />)
    expect(screen.getByTestId('context-menu-settings')).toBeInTheDocument()
    expect(screen.getByText('settings.contextMenu.title')).toBeInTheDocument()

    const catalog = listCatalogItems()
    expect(catalog.length).toBeGreaterThan(0)
    for (const item of catalog) {
      expect(screen.getByTestId(`context-menu-settings-item-${item.id}`)).toBeInTheDocument()
    }
  })

  it('hides an item via checkbox and persists disabledIds', () => {
    render(<ContextMenuSettings />)
    const id = 'message.copy'
    const checkbox = screen.getByTestId(`context-menu-settings-visible-${id}`)
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()
    expect(loadPrefs().disabledIds).toContain(id)
    expect(localStorage.getItem(CONTEXT_MENU_PREFS_KEY)).toContain(id)
  })

  it('reorders with up/down and persists orderByKind', () => {
    render(<ContextMenuSettings />)
    const kind = 'message'
    const section = screen.getByTestId(`context-menu-settings-kind-${kind}`)
    const items = listCatalogItems(kind)
    expect(items.length).toBeGreaterThanOrEqual(2)
    const firstId = items[0]!.id
    const secondId = items[1]!.id

    fireEvent.click(within(section).getByTestId(`context-menu-settings-down-${firstId}`))

    const prefs = loadPrefs()
    expect(prefs.orderByKind?.[kind]?.[0]).toBe(secondId)
    expect(prefs.orderByKind?.[kind]?.[1]).toBe(firstId)

    // DOM order follows prefs
    const rows = within(section).getAllByTestId(/context-menu-settings-item-/)
    expect(rows[0]).toHaveAttribute('data-testid', `context-menu-settings-item-${secondId}`)
  })

  it('reset restores defaults and clears storage', () => {
    render(<ContextMenuSettings />)
    fireEvent.click(screen.getByTestId('context-menu-settings-visible-message.copy'))
    expect(loadPrefs().disabledIds).toContain('message.copy')

    fireEvent.click(screen.getByTestId('context-menu-settings-reset'))
    expect(loadPrefs()).toEqual({ version: 1, disabledIds: [] })
    expect(localStorage.getItem(CONTEXT_MENU_PREFS_KEY)).toBeNull()
    expect(screen.getByTestId('context-menu-settings-visible-message.copy')).toBeChecked()
  })
})
