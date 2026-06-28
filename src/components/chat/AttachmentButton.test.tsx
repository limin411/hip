// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { AttachmentButton } from './AttachmentButton'
import * as providersStore from '@/store/providersStore'
import * as hipConfigStore from '@/store/hipConfigStore'
import * as domain from '@/domain'
import * as draftStore from '@/store/draftStore'
import { pickAttachmentFiles } from '@/ipc/dialog'
import type { Catalog } from '@/ipc/catalog'

vi.mock('@/ipc/dialog', () => ({
  pickAttachmentFiles: vi.fn(),
}))

function mockStores(
  catalog: any,
  agents: any[] = [],
  activeModel = { providerID: 'openai', modelID: 'gpt-4' },
) {
  vi.spyOn(providersStore, 'useProvidersStore').mockImplementation((selector: any) =>
    selector({ catalog, config: { providers: {}, activeModel } }),
  )
  vi.spyOn(hipConfigStore, 'useHipConfigStore').mockImplementation((selector: any) => selector({ config: { agents } }))
  vi.spyOn(domain, 'useActiveSessionId').mockReturnValue(null)
  vi.spyOn(domain, 'useActiveSession').mockReturnValue(null)
  vi.spyOn(draftStore, 'useDraftStore').mockImplementation((selector: any) => selector({ draft: null, setModelKey: vi.fn() }))
}

describe('AttachmentButton', () => {
  beforeEach(() => {
    cleanup()
    vi.restoreAllMocks()
    providersStore.useProvidersStore.setState({ catalog: {}, config: { providers: {} }, keyConfigured: {}, loaded: false })
    hipConfigStore.useHipConfigStore.setState({ config: { version: 1 }, loaded: false, error: null })
    draftStore.useDraftStore.setState({ draft: null })
  })

  it('renders when current model supports attachments', () => {
    mockStores(
      {
        openai: { id: 'openai', name: 'OpenAI', env: [], models: { 'gpt-4o': { id: 'gpt-4o', attachment: true } } },
      },
      [],
      { providerID: 'openai', modelID: 'gpt-4o' },
    )
    render(<AttachmentButton onAttach={vi.fn()} />)
    expect(screen.getByTestId('attachment-button')).toBeInTheDocument()
  })

  it('does not render when no model supports attachments', () => {
    mockStores({
      openai: { id: 'openai', name: 'OpenAI', env: [], models: { 'gpt-4': { id: 'gpt-4', attachment: false } } },
    })
    render(<AttachmentButton onAttach={vi.fn()} />)
    expect(screen.queryByTestId('attachment-button')).not.toBeInTheDocument()
  })

  it('calls onAttach with mapped attachments when files are picked', async () => {
    mockStores(
      {
        openai: { id: 'openai', name: 'OpenAI', env: [], models: { 'gpt-4o': { id: 'gpt-4o', attachment: true } } },
      },
      [],
      { providerID: 'openai', modelID: 'gpt-4o' },
    )
    vi.mocked(pickAttachmentFiles).mockResolvedValue(['/path/to/file.png', 'C:\\\\Users\\\\file.pdf'])
    const onAttach = vi.fn()
    render(<AttachmentButton onAttach={onAttach} />)

    fireEvent.click(screen.getByTestId('attachment-button'))

    await vi.waitFor(() => {
      expect(onAttach).toHaveBeenCalledTimes(1)
      const attachments = onAttach.mock.calls[0][0]
      expect(attachments).toHaveLength(2)
      expect(attachments[0].name).toBe('file.png')
      expect(attachments[0].mimeType).toBe('image/png')
      expect(attachments[1].name).toBe('file.pdf')
      expect(attachments[1].mimeType).toBe('application/pdf')
      expect(attachments[0].id).toBeDefined()
      expect(attachments[0].path).toBe('/path/to/file.png')
    })
  })

  it('does not infinite-loop when agents is absent (real Zustand store)', () => {
    const catalog: Catalog = {
      openai: { id: 'openai', name: 'OpenAI', env: [], models: { 'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', attachment: true } } },
    }
    providersStore.useProvidersStore.setState({
      catalog,
      config: { providers: { openai: { enabled: true } }, activeModel: { providerID: 'openai', modelID: 'gpt-4o' } },
      keyConfigured: {},
      loaded: true,
    })
    hipConfigStore.useHipConfigStore.setState({ config: { version: 1 }, loaded: true, error: null })

    expect(() => render(<AttachmentButton onAttach={vi.fn()} />)).not.toThrow()
    expect(screen.getByTestId('attachment-button')).toBeInTheDocument()
  })
})
