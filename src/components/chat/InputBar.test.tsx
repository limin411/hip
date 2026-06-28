// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { InputBar } from './InputBar'
import * as providersStore from '@/store/providersStore'
import * as hipConfigStore from '@/store/hipConfigStore'
import * as draftStore from '@/store/draftStore'
import * as domain from '@/domain'
import { pickAttachmentFiles } from '@/ipc/dialog'

vi.mock('@/ipc/dialog', () => ({
  pickAttachmentFiles: vi.fn(),
}))

const multimodalCatalog = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    env: [],
    models: {
      'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', attachment: true },
      'gpt-4': { id: 'gpt-4', name: 'GPT-4', attachment: false },
    },
  },
}

function baseMocks() {
  vi.spyOn(providersStore, 'useProvidersStore').mockImplementation((selector: any) =>
    selector({
      catalog: multimodalCatalog,
      config: { providers: {}, activeModel: { providerID: 'openai', modelID: 'gpt-4o' } },
    }),
  )
  vi.spyOn(hipConfigStore, 'useHipConfigStore').mockImplementation((selector: any) => selector({ config: { agents: [] } }))
  vi.spyOn(draftStore, 'useDraftStore').mockImplementation((selector: any) => selector({ draft: null }))
  vi.spyOn(domain, 'useActiveSessionId').mockReturnValue('s1')
  vi.spyOn(domain, 'useActiveSessionStatus').mockReturnValue('idle')
  vi.spyOn(domain, 'useConnectionStatus').mockReturnValue('connected')
}

describe('InputBar', () => {
  beforeEach(() => {
    cleanup()
    vi.restoreAllMocks()
    providersStore.useProvidersStore.setState({ catalog: {}, config: { providers: {} }, keyConfigured: {}, loaded: false })
    hipConfigStore.useHipConfigStore.setState({ config: { version: 1 }, loaded: false, error: null })
    draftStore.useDraftStore.setState({ draft: null })
  })

  it('clears existing attachments when the active session model loses attachment support', async () => {
    baseMocks()
    const session = {
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    }
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(session as any)
    vi.mocked(pickAttachmentFiles).mockResolvedValue(['/path/to/image.png'])

    const { rerender } = render(<InputBar />)

    fireEvent.click(screen.getByTestId('attachment-button'))
    await vi.waitFor(() => {
      expect(screen.getByTestId('attachment-chip')).toBeInTheDocument()
    })

    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      ...session,
      config: { llmProvider: 'openai', model: 'gpt-4', tools: [] },
    } as any)
    rerender(<InputBar />)

    await vi.waitFor(() => {
      expect(screen.queryByTestId('attachment-chip')).not.toBeInTheDocument()
    })
  })
})
