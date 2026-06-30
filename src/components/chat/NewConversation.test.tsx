// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { NewConversation } from './NewConversation'
import * as domain from '@/domain'
import { useDomainStore } from '@/domain'
import * as providersStore from '@/store/providersStore'
import * as hipConfigStore from '@/store/hipConfigStore'
import { useDraftStore } from '@/store/draftStore'
import { useSkillsStore } from '@/store/skillsStore'
import { pickAttachmentFiles } from '@/ipc/dialog'

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@/ipc/dialog', () => ({
  pickAttachmentFiles: vi.fn(),
}))

const mockSetActiveView = vi.fn()
const mockSetTab = vi.fn()

vi.mock('@/store/uiStore', () => ({
  useUiStore: Object.assign(
    (selector?: (s: { setActiveView: typeof mockSetActiveView; setTab: typeof mockSetTab }) => unknown) => {
      if (typeof selector === 'function') {
        return selector({ setActiveView: mockSetActiveView, setTab: mockSetTab })
      }
      return { setActiveView: mockSetActiveView, setTab: mockSetTab }
    },
    { getState: () => ({ setActiveView: mockSetActiveView, setTab: mockSetTab }) },
  ),
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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('NewConversation', () => {
  beforeEach(() => {
    cleanup()
    vi.restoreAllMocks()
    mockSetActiveView.mockClear()
    mockSetTab.mockClear()
    providersStore.useProvidersStore.setState({
      catalog,
      config: { providers: {}, activeModel: { providerID: 'openai', modelID: 'gpt-4o' } },
      keyConfigured: {},
      loaded: false,
    })
    hipConfigStore.useHipConfigStore.setState({ config: { version: 1, agents: [] }, loaded: false, error: null })
    useDraftStore.setState({ draft: null })
    useSkillsStore.setState({ skills: [], enabled: {}, loaded: false })
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

  it('renders slash palette when typing / in composer', async () => {
    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: '/cle', modelKey: 'openai/gpt-4o' } })
    render(<NewConversation />)
    expect(screen.getByTestId('slash-palette')).toBeInTheDocument()
    expect(screen.getByTestId('slash-cmd-clear')).toBeInTheDocument()
  })

  it('does not render slash palette when composer text has no slash', () => {
    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: 'hello', modelKey: 'openai/gpt-4o' } })
    render(<NewConversation />)
    expect(screen.queryByTestId('slash-palette')).not.toBeInTheDocument()
  })

  it('renders builtin /clear and /config in slash palette', async () => {
    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: '/', modelKey: 'openai/gpt-4o' } })
    render(<NewConversation />)
    expect(screen.getByTestId('slash-palette')).toBeInTheDocument()
    expect(screen.getByTestId('slash-cmd-clear')).toBeInTheDocument()
    expect(screen.getByTestId('slash-cmd-config')).toBeInTheDocument()
  })

  // ── Slash command handler tests ──────────────────────────────────────────────

  it('/help command injects help message and clears input', async () => {
    vi.spyOn(domain, 'useActiveSessionId').mockReturnValue('s1')
    const appendSpy = vi.spyOn(useDomainStore.getState(), 'appendMessage').mockImplementation(vi.fn())

    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: '/h', modelKey: 'openai/gpt-4o' } })
    render(<NewConversation />)

    const helpButton = screen.getByText('/help')
    expect(helpButton).toBeInTheDocument()

    fireEvent.click(helpButton)

    expect(appendSpy).toHaveBeenCalledTimes(1)
    const [sessionId, message] = appendSpy.mock.calls[0]
    expect(sessionId).toBe('s1')
    expect(message.role).toBe('assistant')
    expect(message.content).toContain('Available commands:')
    expect(message.content).toContain('/help')
    expect(message.content).toContain('/clear')
    expect(message.content).toContain('/config')
    expect(message.content).not.toContain('/diff')
    expect(message.content).not.toContain('/init')
    expect(message.content).not.toContain('/compact')
    // Draft text should be cleared
    expect(useDraftStore.getState().draft?.text).toBe('')
  })

  it('/diff command is hidden in chat surface', async () => {
    vi.spyOn(domain, 'useActiveSessionId').mockReturnValue('s1')

    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: '/dif', modelKey: 'openai/gpt-4o' } })
    render(<NewConversation />)

    expect(screen.queryByText('/diff')).not.toBeInTheDocument()
  })

  it('/init command is hidden in chat surface', async () => {
    vi.spyOn(domain, 'useActiveSessionId').mockReturnValue('s1')

    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: '/in', modelKey: 'openai/gpt-4o' } })
    render(<NewConversation />)

    expect(screen.queryByText('/init')).not.toBeInTheDocument()
  })

  it('/compact command is hidden in chat surface', async () => {
    vi.spyOn(domain, 'useActiveSessionId').mockReturnValue('s1')

    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: '/comp', modelKey: 'openai/gpt-4o' } })
    render(<NewConversation />)

    expect(screen.queryByText('/compact')).not.toBeInTheDocument()
  })
})
