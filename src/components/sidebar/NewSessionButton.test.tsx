import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NewSessionButton } from './NewSessionButton'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/domain', () => ({
  sessionService: { newConversation: vi.fn() },
}))

describe('NewSessionButton', () => {
  it('renders chat label', () => {
    const html = renderToStaticMarkup(<NewSessionButton surface="chat" />)
    expect(html).toContain('sidebar.newChat')
  })

  it('renders code label', () => {
    const html = renderToStaticMarkup(<NewSessionButton surface="code" />)
    expect(html).toContain('sidebar.newCodeTask')
  })
})
