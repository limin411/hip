// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { NewConversation } from './NewConversation'
import * as domain from '@/domain'
import { useDomainStore, sessionService } from '@/domain'
import i18n from '@/i18n'
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
let mockActiveView: 'chat' | 'code' | 'settings' = 'chat'

vi.mock('@/store/uiStore', () => ({
  useUiStore: Object.assign(
    (selector?: (s: { activeView: typeof mockActiveView; setActiveView: typeof mockSetActiveView; setTab: typeof mockSetTab }) => unknown) => {
      if (typeof selector === 'function') {
        return selector({ activeView: mockActiveView, setActiveView: mockSetActiveView, setTab: mockSetTab })
      }
      return { activeView: mockActiveView, setActiveView: mockSetActiveView, setTab: mockSetTab }
    },
    { getState: () => ({ activeView: mockActiveView, setActiveView: mockSetActiveView, setTab: mockSetTab }) },
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
  beforeEach(async () => {
    cleanup()
    vi.restoreAllMocks()
    await i18n.changeLanguage('en')
    mockActiveView = 'chat'
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
    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: '', modelKey: 'openai/gpt-4o' } })
    render(<NewConversation />)
    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/cle' } })
    expect(screen.getByTestId('slash-palette')).toBeInTheDocument()
    expect(screen.getByTestId('slash-cmd-clear')).toBeInTheDocument()
  })

  it('does not render slash palette when composer text has no slash', () => {
    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: 'hello', modelKey: 'openai/gpt-4o' } })
    render(<NewConversation />)
    expect(screen.queryByTestId('slash-palette')).not.toBeInTheDocument()
  })

  it('clears a stale slash query on mount so the palette does not open by default', async () => {
    // Simulates a persisted draft where the user previously typed '/' and left it there.
    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: '/', modelKey: 'openai/gpt-4o' } })
    render(<NewConversation />)
    await vi.waitFor(() => {
      expect(useDraftStore.getState().draft?.text).toBe('')
    })
    expect(screen.queryByTestId('slash-palette')).not.toBeInTheDocument()
  })

  it('does not clear slash query text again when surface changes after mount', async () => {
    mockActiveView = 'chat'
    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: '/help', modelKey: 'openai/gpt-4o' } })
    const { rerender } = render(<NewConversation />)

    // Mount clears the stale slash query.
    await vi.waitFor(() => {
      expect(useDraftStore.getState().draft?.text).toBe('')
    })

    // User retypes a slash command.
    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/help' } })
    expect(screen.getByTestId('slash-palette')).toBeInTheDocument()

    // Switching to code surface must not wipe the active slash query.
    mockActiveView = 'code'
    rerender(<NewConversation />)

    expect(useDraftStore.getState().draft?.text).toBe('/help')
    expect(screen.getByTestId('slash-palette')).toBeInTheDocument()
  })

  it('creates a project-mode draft on the code surface', async () => {
    mockActiveView = 'code'
    render(<NewConversation />)
    await vi.waitFor(() => {
      expect(useDraftStore.getState().draft?.mode).toBe('project')
    })
  })

  it('renders builtin /clear and /config in slash palette', async () => {
    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: '', modelKey: 'openai/gpt-4o' } })
    render(<NewConversation />)
    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/' } })
    expect(screen.getByTestId('slash-palette')).toBeInTheDocument()
    expect(screen.getByTestId('slash-cmd-clear')).toBeInTheDocument()
    expect(screen.getByTestId('slash-cmd-config')).toBeInTheDocument()
  })

  // ── Slash command handler tests ──────────────────────────────────────────────

  it('/help command injects help message and clears input', async () => {
    vi.spyOn(domain, 'useActiveSessionId').mockReturnValue('s1')
    const appendSpy = vi.spyOn(useDomainStore.getState(), 'appendMessage').mockImplementation(vi.fn())

    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: '', modelKey: 'openai/gpt-4o' } })
    render(<NewConversation />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/h' } })
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

  it('/help command is selected by pressing Enter after typing', async () => {
    vi.spyOn(domain, 'useActiveSessionId').mockReturnValue('s1')
    const appendSpy = vi.spyOn(useDomainStore.getState(), 'appendMessage').mockImplementation(vi.fn())

    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: '', modelKey: 'openai/gpt-4o' } })
    render(<NewConversation />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/h' } })
    expect(screen.getByTestId('slash-cmd-help')).toBeInTheDocument()

    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    expect(appendSpy).toHaveBeenCalledTimes(1)
    const [sessionId, message] = appendSpy.mock.calls[0]
    expect(sessionId).toBe('s1')
    expect(message.role).toBe('assistant')
    expect(message.content).toContain('Available commands:')
    expect(useDraftStore.getState().draft?.text).toBe('')
  })

  it('uses controlled value instead of ref value when selecting a skill by Enter', async () => {
    vi.spyOn(domain, 'useActiveSessionId').mockReturnValue('s1')
    useSkillsStore.setState({ skills: [{ id: 'sk1', name: 'my-skill', description: 'A skill', dir: '/tmp', hasScripts: false }], enabled: {}, loaded: false })
    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: '', modelKey: 'openai/gpt-4o' } })
    render(<NewConversation />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: 'do /my' } })
    expect(screen.getByTestId('slash-cmd-my-skill')).toBeInTheDocument()

    // Simulate the DOM value being cleared behind React's back (e.g. a ref race) and
    // verify the handler still uses the controlled React value, not the DOM value.
    ;(textarea as HTMLTextAreaElement).value = ''

    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    expect(useDraftStore.getState().draft?.text).toBe('do /my-skill ')
  })

  it('/diff command is hidden in chat surface', async () => {
    vi.spyOn(domain, 'useActiveSessionId').mockReturnValue('s1')

    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: '', modelKey: 'openai/gpt-4o' } })
    render(<NewConversation />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/dif' } })
    expect(screen.queryByText('/diff')).not.toBeInTheDocument()
  })

  it('/init command is hidden in chat surface', async () => {
    vi.spyOn(domain, 'useActiveSessionId').mockReturnValue('s1')

    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: '', modelKey: 'openai/gpt-4o' } })
    render(<NewConversation />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/in' } })
    expect(screen.queryByText('/init')).not.toBeInTheDocument()
  })

  it('/compact command is hidden in chat surface', async () => {
    vi.spyOn(domain, 'useActiveSessionId').mockReturnValue('s1')

    useDraftStore.setState({ draft: { tempId: 'draft-1', mode: 'chat', text: '', modelKey: 'openai/gpt-4o' } })
    render(<NewConversation />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/comp' } })
    expect(screen.queryByText('/compact')).not.toBeInTheDocument()
  })
})

describe('NewConversation surface toggle', () => {
  beforeEach(async () => {
    cleanup()
    vi.restoreAllMocks()
    mockActiveView = 'chat'
    await i18n.changeLanguage('en')
    useDraftStore.setState({ draft: null })
  })

  it('renders Chat and Code toggle', () => {
    render(<NewConversation />)
    expect(screen.getByTestId('surface-toggle-chat')).toBeInTheDocument()
    expect(screen.getByTestId('surface-toggle-code')).toBeInTheDocument()
  })

  it('switches surface when the code toggle is clicked', () => {
    const setSurfaceSpy = vi.spyOn(sessionService, 'setSurface').mockImplementation(() => {})
    render(<NewConversation />)
    fireEvent.click(screen.getByTestId('surface-toggle-code'))
    expect(setSurfaceSpy).toHaveBeenCalledWith('code')
  })
})
