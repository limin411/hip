// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Automation } from '@/domain/automations'

let windowCfg: { closeAction: string; trayEnabled: boolean }

vi.mock('@/store/hipConfigStore', () => {
  const useHipConfigStore = (sel: (s: { config: { window: typeof windowCfg } }) => unknown) =>
    sel({ config: { window: windowCfg } })
  return { useHipConfigStore }
})

const setSettingsPage = vi.fn()
const setActiveView = vi.fn()
vi.mock('@/store/uiStore', () => ({
  useUiStore: {
    getState: () => ({ setSettingsPage, setActiveView }),
  },
}))

import { AutomationScheduleBanner } from './AutomationScheduleBanner'

function dailyAuto(enabled = true): Automation {
  return {
    id: 'auto_sched',
    name: 'Scheduled',
    prompt: 'hi',
    enabled,
    trigger: { kind: 'daily', hour: 9, minute: 0 },
    createdAt: 1,
    updatedAt: 1,
  }
}

function manualAuto(): Automation {
  return {
    id: 'auto_manual',
    name: 'Manual',
    prompt: 'hi',
    enabled: true,
    trigger: { kind: 'manual' },
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('AutomationScheduleBanner', () => {
  beforeEach(() => {
    setSettingsPage.mockClear()
    setActiveView.mockClear()
    windowCfg = { closeAction: 'quit', trayEnabled: false }
  })

  afterEach(() => cleanup())

  it('shows when scheduled automation enabled and close=quit', () => {
    render(<AutomationScheduleBanner automations={[dailyAuto(true)]} />)
    expect(screen.getByTestId('automation-schedule-banner')).toBeInTheDocument()
  })

  it('hides when close=hide and tray enabled', () => {
    windowCfg = { closeAction: 'hide', trayEnabled: true }
    render(<AutomationScheduleBanner automations={[dailyAuto(true)]} />)
    expect(screen.queryByTestId('automation-schedule-banner')).not.toBeInTheDocument()
  })

  it('hides for manual-only automations even when quit/tray unfavorable', () => {
    render(<AutomationScheduleBanner automations={[manualAuto()]} />)
    expect(screen.queryByTestId('automation-schedule-banner')).not.toBeInTheDocument()
  })

  it('hides after dismiss (session-only)', () => {
    render(<AutomationScheduleBanner automations={[dailyAuto(true)]} />)
    fireEvent.click(screen.getByTestId('automation-banner-dismiss'))
    expect(screen.queryByTestId('automation-schedule-banner')).not.toBeInTheDocument()
  })

  it('open settings deep-links to window page', () => {
    render(<AutomationScheduleBanner automations={[dailyAuto(true)]} />)
    fireEvent.click(screen.getByTestId('automation-banner-open-settings'))
    expect(setSettingsPage).toHaveBeenCalledWith('window')
    expect(setActiveView).toHaveBeenCalledWith('settings')
  })
})
