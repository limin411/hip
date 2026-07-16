// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useUiStore } from '@/store/uiStore'
import { AppLayout } from './AppLayout'

vi.mock('@/components/history/SessionHistory', () => ({ SessionHistory: () => <div data-testid="session-history" /> }))

afterEach(() => {
  cleanup()
  useUiStore.setState({ activeView: 'chat' })
})

vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children, className }: { children: any; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Panel: ({ children, className }: { children: any; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  PanelResizeHandle: ({ className }: { className?: string }) => <div className={className} data-testid="resize-handle" />,
}))

vi.mock('@/components/layout/AppSidebar', () => ({
  AppSidebar: () => <div data-testid="app-sidebar" />,
}))
vi.mock('@/components/layout/MainToolbar', () => ({
  MainToolbar: () => <div data-testid="main-toolbar" />,
}))
vi.mock('@/components/chat/NewConversation', () => ({ NewConversation: () => <div data-testid="new-conversation" /> }))
vi.mock('@/components/chat/ChatPane', () => ({ ChatPane: () => <div data-testid="chat-pane" /> }))
vi.mock('@/components/chat/InputBar', () => ({ InputBar: () => <div data-testid="input-bar" /> }))
vi.mock('@/components/account/SettingsPage', () => ({ SettingsPage: () => <div data-testid="settings-page" /> }))
vi.mock('@/components/knowledge/KnowledgePage', () => ({ KnowledgePage: () => <div data-testid="knowledge-page" /> }))

describe('AppLayout', () => {
  it('renders final shell: sidebar + main toolbar, no title bar / floating avatar', () => {
    render(<AppLayout />, { wrapper: MemoryRouter })
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('main-toolbar')).toBeInTheDocument()
    expect(screen.queryByTestId('title-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('floating-avatar')).not.toBeInTheDocument()
  })

  it('renders history view with main toolbar', () => {
    useUiStore.setState({ activeView: 'history' })
    render(<AppLayout />, { wrapper: MemoryRouter })
    expect(screen.getByTestId('session-history')).toBeInTheDocument()
    expect(screen.getByTestId('main-toolbar')).toBeInTheDocument()
  })

  it('renders knowledge view', () => {
    useUiStore.setState({ activeView: 'knowledge' })
    render(<AppLayout />, { wrapper: MemoryRouter })
    expect(screen.getByTestId('knowledge-page')).toBeInTheDocument()
  })

  it('renders settings view with main toolbar', () => {
    useUiStore.setState({ activeView: 'settings' })
    render(<AppLayout />, { wrapper: MemoryRouter })
    expect(screen.getByTestId('settings-page')).toBeInTheDocument()
    expect(screen.getByTestId('main-toolbar')).toBeInTheDocument()
  })
})
