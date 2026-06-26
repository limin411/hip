// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { forwardRef, type ReactNode } from 'react'
import { useUiStore } from '@/store/uiStore'
import { SettingsPanel } from './SettingsPanel'

vi.mock(import('react-i18next'), async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Panel: forwardRef<HTMLDivElement, { children?: ReactNode }>(({ children }, ref) => (
    <div ref={ref}>{children}</div>
  )),
  PanelResizeHandle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

describe('SettingsPanel', () => {
  beforeEach(() => {
    useUiStore.setState({ activeView: 'chat', previousView: null })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders a back button at the bottom of the settings nav', () => {
    useUiStore.setState({ activeView: 'settings', previousView: 'code' })
    render(<SettingsPanel />)
    expect(screen.getByText('common.back')).toBeInTheDocument()
  })

  it('returns to the previous view when back is clicked', () => {
    useUiStore.setState({ activeView: 'settings', previousView: 'code' })
    render(<SettingsPanel />)

    fireEvent.click(screen.getByText('common.back'))

    expect(useUiStore.getState().activeView).toBe('code')
    expect(useUiStore.getState().previousView).toBeNull()
  })

  it('falls back to chat when there is no previous view', () => {
    useUiStore.setState({ activeView: 'settings', previousView: null })
    render(<SettingsPanel />)

    fireEvent.click(screen.getByText('common.back'))

    expect(useUiStore.getState().activeView).toBe('chat')
  })
})
