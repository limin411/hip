import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AccountFooter } from './AccountFooter'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: any) => any) => selector({ logout: vi.fn() }),
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: any) => any) => selector({ setActiveView: vi.fn() }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/components/ui/DropdownMenu', async () => {
  const React = await import('react')
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'menu-content' }, children),
    DropdownMenuItem: ({ children }: { children: React.ReactNode }) => React.createElement('button', null, children),
    DropdownMenuSeparator: () => React.createElement('hr'),
    DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  }
})

describe('AccountFooter', () => {
  it('renders user name and email', () => {
    const html = renderToStaticMarkup(<AccountFooter />)
    expect(html).toContain('User')
    expect(html).toContain('user@example.com')
  })

  it('renders as a card container with rounded background', () => {
    const html = renderToStaticMarkup(<AccountFooter />)
    expect(html).toContain('rounded-lg')
    expect(html).toContain('bg-surface-muted')
    expect(html).toContain('border-border')
  })

  it('renders avatar with gradient', () => {
    const html = renderToStaticMarkup(<AccountFooter />)
    expect(html).toContain('linear-gradient(135deg, var(--accent), var(--accent-hover))')
  })

  it('does not use flat border-t separator on trigger button', () => {
    const html = renderToStaticMarkup(<AccountFooter />)
    expect(html).not.toMatch(/border-t border-border pt-3/)
  })

  it('shows keyboard shortcut hint in settings menu item', () => {
    const html = renderToStaticMarkup(<AccountFooter />)
    // \u2318 is the ⌘ symbol
    expect(html).toContain('\u2318,')
  })

  it('shows logout item without shortcut hint', () => {
    const html = renderToStaticMarkup(<AccountFooter />)
    expect(html).toContain('common.logout')
  })
})

