import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SurfaceTabs } from './SurfaceTabs'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('SurfaceTabs', () => {
  it('renders chat, code, and domain labels', () => {
    const html = renderToStaticMarkup(<SurfaceTabs active="chat" onChange={() => {}} />)
    expect(html).toContain('nav.chat')
    expect(html).toContain('nav.code')
    expect(html).toContain('nav.domain')
  })

  it('marks active tab with selected styling', () => {
    const html = renderToStaticMarkup(<SurfaceTabs active="code" onChange={() => {}} />)
    expect(html).toContain('aria-pressed="true"')
  })
})
