// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { FirstRunSetupCard } from './FirstRunSetupCard'
import * as providersStore from '@/store/providersStore'
import * as uiStore from '@/store/uiStore'
import * as draftStore from '@/store/draftStore'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  }
})

vi.mock('@/ipc/dialog', () => ({
  pickDirectory: vi.fn().mockResolvedValue('/tmp/project'),
}))

describe('FirstRunSetupCard', () => {
  beforeEach(() => {
    cleanup()
    vi.restoreAllMocks()
    providersStore.useProvidersStore.setState({
      catalog: {},
      config: { providers: {} },
      keyConfigured: {},
      loaded: true,
    })
    draftStore.useDraftStore.setState({ draft: null })
  })

  it('shows no-key three-step card when unloaded keys', () => {
    render(<FirstRunSetupCard surface="chat" />)
    expect(screen.getByTestId('first-run-setup')).toHaveAttribute('data-variant', 'no-key')
    expect(screen.getByTestId('first-run-add-key')).toBeInTheDocument()
  })

  it('hides when chat has a key', () => {
    providersStore.useProvidersStore.setState({
      keyConfigured: { openai: true },
      loaded: true,
    })
    const { container } = render(<FirstRunSetupCard surface="chat" />)
    expect(container.querySelector('[data-testid="first-run-setup"]')).toBeNull()
  })

  it('hides when code has a key even without folder (FolderPill owns folder UX)', () => {
    providersStore.useProvidersStore.setState({
      keyConfigured: { openai: true },
      loaded: true,
    })
    const { container } = render(<FirstRunSetupCard surface="code" />)
    expect(container.querySelector('[data-testid="first-run-setup"]')).toBeNull()
  })

  it('shows no-key card on code surface without key (includes folder step)', () => {
    render(<FirstRunSetupCard surface="code" />)
    expect(screen.getByTestId('first-run-setup')).toHaveAttribute('data-variant', 'no-key')
    expect(screen.getByTestId('first-run-pick-folder')).toBeInTheDocument()
  })

  it('open models CTA switches settings page', () => {
    const setSettingsPage = vi.spyOn(uiStore.useUiStore.getState(), 'setSettingsPage')
    const setActiveView = vi.spyOn(uiStore.useUiStore.getState(), 'setActiveView')
    render(<FirstRunSetupCard surface="chat" />)
    fireEvent.click(screen.getByTestId('first-run-add-key'))
    expect(setSettingsPage).toHaveBeenCalledWith('model')
    expect(setActiveView).toHaveBeenCalledWith('settings')
  })
})
