// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Automation } from '@/domain/automations'
import '@/i18n'
import { useUiStore } from '@/store/uiStore'

const load = vi.fn().mockResolvedValue(undefined)
const select = vi.fn()
const enterAutomationsSection = vi.fn(async () => {})

let storeState: {
  loaded: boolean
  automations: Automation[]
  selectedId: string | null
}

vi.mock('@/store/automationStore', () => {
  const useAutomationStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      ...storeState,
      load,
      select,
    })
  useAutomationStore.getState = () => ({
    ...storeState,
    load,
    select,
  })
  return {
    useAutomationStore,
    isInFlight: () => false,
    subscribeInFlight: () => () => {},
    getInFlightVersion: () => 0,
    listInFlightIds: () => [],
  }
})

vi.mock('@/components/layout/sidebarActions', () => ({
  enterAutomationsSection: () => enterAutomationsSection(),
}))

import { AutomationSidebarList } from './AutomationSidebarList'

function auto(partial: Partial<Automation> & { id: string }): Automation {
  return {
    name: 'Job',
    prompt: 'do it',
    enabled: true,
    trigger: { kind: 'manual' },
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

describe('AutomationSidebarList', () => {
  beforeEach(() => {
    load.mockClear()
    select.mockClear()
    enterAutomationsSection.mockClear()
    storeState = {
      loaded: true,
      automations: [],
      selectedId: null,
    }
    useUiStore.setState({ activeView: 'automation', sidebarSection: 'automation' })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows empty state when no enabled automations', () => {
    storeState.automations = [
      auto({ id: 'auto_off', name: 'Off', enabled: false }),
    ]
    render(<AutomationSidebarList />)
    expect(screen.getByTestId('sidebar-automations-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-automations')).not.toBeInTheDocument()
  })

  it('lists only enabled automations', () => {
    storeState.automations = [
      auto({ id: 'auto_on', name: 'On job', enabled: true }),
      auto({ id: 'auto_off', name: 'Off job', enabled: false }),
      auto({
        id: 'auto_daily',
        name: 'Daily',
        enabled: true,
        trigger: { kind: 'daily', hour: 9, minute: 0 },
      }),
    ]
    render(<AutomationSidebarList />)
    expect(screen.getByTestId('sidebar-automations')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-automation-auto_on')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-automation-auto_daily')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-automation-auto_off')).not.toBeInTheDocument()
    expect(screen.getByText('On job')).toBeInTheDocument()
    expect(screen.getByText('Daily')).toBeInTheDocument()
  })

  it('selects automation on click without re-entering when already on view', () => {
    storeState.automations = [auto({ id: 'auto_a', name: 'A' })]
    useUiStore.setState({ activeView: 'automation' })
    render(<AutomationSidebarList />)
    fireEvent.click(screen.getByTestId('sidebar-automation-auto_a'))
    expect(select).toHaveBeenCalledWith('auto_a')
    expect(enterAutomationsSection).not.toHaveBeenCalled()
  })

  it('enters automation section when selecting from another view', () => {
    storeState.automations = [auto({ id: 'auto_b', name: 'B' })]
    useUiStore.setState({ activeView: 'chat', sidebarSection: 'chats' })
    render(<AutomationSidebarList />)
    fireEvent.click(screen.getByTestId('sidebar-automation-auto_b'))
    expect(select).toHaveBeenCalledWith('auto_b')
    expect(enterAutomationsSection).toHaveBeenCalled()
  })

  it('loads catalog when not yet loaded', () => {
    storeState.loaded = false
    render(<AutomationSidebarList />)
    expect(load).toHaveBeenCalled()
  })
})
