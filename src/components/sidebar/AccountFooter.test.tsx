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
})
