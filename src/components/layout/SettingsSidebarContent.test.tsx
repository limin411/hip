// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/store/uiStore'

const closeOverlay = vi.fn()

vi.mock('./sidebarActions', () => ({
  closeOverlay: () => closeOverlay(),
}))

// Avoid loading every settings page component in this unit test.
vi.mock('@/components/account/settingsNav', () => ({
  SETTINGS_NAV_GROUPS: [
    {
      id: 'basics',
      labelKey: 'settings.groups.basics',
      pages: [
        {
          id: 'general',
          icon: () => null,
          labelKey: 'settings.general',
          Component: () => null,
        },
        {
          id: 'model',
          icon: () => null,
          labelKey: 'settings.model',
          Component: () => null,
        },
      ],
    },
  ],
}))

import { SettingsSidebarContent } from './SettingsSidebarContent'

describe('SettingsSidebarContent', () => {
  beforeEach(() => {
    closeOverlay.mockClear()
    useUiStore.setState({
      settingsPage: 'general',
      overlay: 'settings',
      settingsShellRoute: { type: 'page' },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders category nav and switches settingsPage', () => {
    render(<SettingsSidebarContent />)
    expect(screen.getByTestId('settings-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('settings-nav-general')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('settings-nav-model'))
    expect(useUiStore.getState().settingsPage).toBe('model')
  })

  it('back button leaves settings', () => {
    render(<SettingsSidebarContent />)
    fireEvent.click(screen.getByTestId('settings-sidebar-back'))
    expect(closeOverlay).toHaveBeenCalledTimes(1)
  })
})
