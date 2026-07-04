// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PanelToggle } from './PanelToggle'

afterEach(cleanup)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

let mockActiveView = 'chat'

const toggleChatPanel = vi.fn()
const togglePanel = vi.fn()

vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (state: any) => any) =>
    selector({
      activeView: mockActiveView,
      toggleChatPanel,
      togglePanel,
    }),
}))

describe('PanelToggle', () => {
  afterEach(() => {
    mockActiveView = 'chat'
    vi.clearAllMocks()
  })

  it('renders toggle button', () => {
    render(<PanelToggle />)
    expect(screen.getByTestId('toggle-panel')).toBeInTheDocument()
  })

  it('calls toggleChatPanel when active view is chat', () => {
    render(<PanelToggle />)
    fireEvent.click(screen.getByTestId('toggle-panel'))
    expect(toggleChatPanel).toHaveBeenCalled()
    expect(togglePanel).not.toHaveBeenCalled()
  })

  it('calls togglePanel when active view is code', () => {
    mockActiveView = 'code'
    render(<PanelToggle />)
    fireEvent.click(screen.getByTestId('toggle-panel'))
    expect(togglePanel).toHaveBeenCalled()
    expect(toggleChatPanel).not.toHaveBeenCalled()
  })
})
