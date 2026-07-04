// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppLayout } from './AppLayout'

vi.mock('@/components/layout/TitleBar', () => ({ TitleBar: () => <div data-testid="title-bar" /> }))
vi.mock('@/components/account/FloatingAvatarButton', () => ({
  FloatingAvatarButton: () => <div data-testid="floating-avatar" />,
}))
vi.mock('@/components/chat/NewConversation', () => ({ NewConversation: () => <div data-testid="new-conversation" /> }))
vi.mock('@/components/chat/ChatPane', () => ({ ChatPane: () => <div data-testid="chat-pane" /> }))
vi.mock('@/components/chat/InputBar', () => ({ InputBar: () => <div data-testid="input-bar" /> }))
vi.mock('@/components/account/SettingsPage', () => ({ SettingsPage: () => <div data-testid="settings-page" /> }))

describe('AppLayout', () => {
  it('renders without sidebar', () => {
    render(<AppLayout />, { wrapper: MemoryRouter })
    expect(screen.getByTestId('title-bar')).toBeInTheDocument()
    expect(screen.getByTestId('floating-avatar')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-root')).not.toBeInTheDocument()
  })
})
