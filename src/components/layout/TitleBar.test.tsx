// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TitleBar } from './TitleBar'

afterEach(cleanup)

vi.mock('@/components/tabs/SessionTabBar', () => ({
  SessionTabBar: () => <div data-testid="session-tab-bar">TabBar</div>,
}))

describe('TitleBar', () => {
  it('renders session tab bar and no sidebar toggle', () => {
    render(<TitleBar />)
    expect(screen.getByTestId('session-tab-bar')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-toggle')).not.toBeInTheDocument()
  })
})
