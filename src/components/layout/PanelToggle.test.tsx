// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PanelToggle } from './PanelToggle'

afterEach(cleanup)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const toggleSessionCodePanel = vi.fn()
const toggleSessionChatPanel = vi.fn()

vi.mock('@/domain', () => ({
  useActiveSessionId: () => mockActiveSessionId,
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (state: any) => any) =>
    selector({
      activeView: mockActiveView,
    }),
}))

vi.mock('@/domain/sessionStore', () => ({
  useDomainStore: (selector: (state: any) => any) =>
    selector({
      toggleSessionCodePanel,
      toggleSessionChatPanel,
    }),
}))

let mockActiveSessionId: string | null = 's1'
let mockActiveView = 'chat'

describe('PanelToggle', () => {
  beforeEach(() => {
    mockActiveSessionId = 's1'
    mockActiveView = 'chat'
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders toggle button', () => {
    render(<PanelToggle />)
    expect(screen.getByTestId('toggle-panel')).toBeInTheDocument()
  })

  it('is disabled when no session is active', () => {
    mockActiveSessionId = null
    render(<PanelToggle />)
    expect(screen.getByTestId('toggle-panel')).toBeDisabled()
  })

  it('calls toggleSessionChatPanel when active view is chat', () => {
    render(<PanelToggle />)
    fireEvent.click(screen.getByTestId('toggle-panel'))
    expect(toggleSessionChatPanel).toHaveBeenCalledWith('s1')
    expect(toggleSessionCodePanel).not.toHaveBeenCalled()
  })

  it('calls toggleSessionCodePanel when active view is code', () => {
    mockActiveView = 'code'
    render(<PanelToggle />)
    fireEvent.click(screen.getByTestId('toggle-panel'))
    expect(toggleSessionCodePanel).toHaveBeenCalledWith('s1')
    expect(toggleSessionChatPanel).not.toHaveBeenCalled()
  })
})
