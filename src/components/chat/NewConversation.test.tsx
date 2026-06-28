// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { NewConversation } from './NewConversation'
import * as providersStore from '@/store/providersStore'
import * as hipConfigStore from '@/store/hipConfigStore'
import { useDraftStore } from '@/store/draftStore'
import { pickAttachmentFiles } from '@/ipc/dialog'

vi.mock('@/ipc/dialog', () => ({
  pickAttachmentFiles: vi.fn(),
}))

const catalog = {
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

function setDraftModel(modelKey: string) {
  useDraftStore.setState({
    draft: {
      tempId: 'draft-1',
      mode: 'chat',
      text: '',
      modelKey,
    },
  })
}

describe('NewConversation', () => {
  beforeEach(() => {
    cleanup()
    vi.restoreAllMocks()
    providersStore.useProvidersStore.setState({
      catalog,
      config: { providers: {}, activeModel: { providerID: 'openai', modelID: 'gpt-4o' } },
      keyConfigured: {},
      loaded: true,
    })
    hipConfigStore.useHipConfigStore.setState({ config: { version: 1, agents: [] }, loaded: true, error: null })
    useDraftStore.setState({ draft: null })
  })

  it('clears existing attachments when the draft model loses attachment support', async () => {
    setDraftModel('openai/gpt-4o')
    vi.mocked(pickAttachmentFiles).mockResolvedValue(['/path/to/image.png'])

    render(<NewConversation />)

    fireEvent.click(screen.getByTestId('attachment-button'))
    await vi.waitFor(() => {
      expect(screen.getByTestId('attachment-chip')).toBeInTheDocument()
    })

    setDraftModel('openai/gpt-4')

    await vi.waitFor(() => {
      expect(screen.queryByTestId('attachment-chip')).not.toBeInTheDocument()
    })
  })
})
