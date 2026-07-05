// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TitleBar } from './TitleBar'
import { useUiStore } from '@/store/uiStore'

beforeEach(() => {
  useUiStore.setState({ activeView: 'chat', previousView: null })
})

afterEach(cleanup)

vi.mock(import('react-i18next'), async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  } as any
})

vi.mock('@/components/tabs/SessionTabBar', () => ({
  SessionTabBar: () => <div data-testid="session-tab-bar">TabBar</div>,
}))

describe('TitleBar', () => {
  it('renders session tab bar and no sidebar toggle', () => {
    render(<TitleBar />)
    expect(screen.getByTestId('session-tab-bar')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-toggle')).not.toBeInTheDocument()
  })

  it('renders back button and title in settings mode', () => {
    useUiStore.setState({ activeView: 'settings', previousView: 'chat' })
    render(<TitleBar />)
    expect(screen.getByTestId('titlebar-back')).toBeInTheDocument()
    expect(screen.getByText('settings.title')).toBeInTheDocument()
    expect(screen.queryByTestId('session-tab-bar')).not.toBeInTheDocument()
  })

  it('renders back button and title in history mode', () => {
    useUiStore.setState({ activeView: 'history', previousView: 'chat' })
    render(<TitleBar />)
    expect(screen.getByTestId('titlebar-back')).toBeInTheDocument()
    expect(screen.getByText('history.title')).toBeInTheDocument()
  })

  it('returns to previous view when back button is clicked', () => {
    useUiStore.setState({ activeView: 'settings', previousView: 'code' })
    render(<TitleBar />)
    screen.getByTestId('titlebar-back').click()
    expect(useUiStore.getState().activeView).toBe('code')
  })

  it('falls back to chat when back button is clicked with no previous view', () => {
    useUiStore.setState({ activeView: 'history', previousView: null })
    render(<TitleBar />)
    screen.getByTestId('titlebar-back').click()
    expect(useUiStore.getState().activeView).toBe('chat')
  })

  it('marks the header as draggable and the back button as non-draggable', () => {
    useUiStore.setState({ activeView: 'settings', previousView: 'chat' })
    render(<TitleBar />)
    expect(screen.getByTestId('titlebar')).toHaveAttribute('data-tauri-drag-region')
    expect(screen.getByTestId('titlebar-back')).toHaveAttribute('data-tauri-drag-region', 'false')
  })
})
