// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { InputBar } from './InputBar'
import * as domain from '@/domain'
import { sessionService, useDomainStore } from '@/domain'
import type { SessionVM } from '@/domain'
import * as providersStore from '@/store/providersStore'
import * as hipConfigStore from '@/store/hipConfigStore'
import * as draftStore from '@/store/draftStore'

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockSetActiveView = vi.fn()
const mockSetTab = vi.fn()

// eslint-disable-next-line no-var
var mockSkills: Array<{ id: string; name: string; description: string; userInvocable?: boolean }> = []

vi.mock('@/store/skillsStore', () => ({
  useSkillsStore: (selector?: (s: { skills: typeof mockSkills }) => unknown) => {
    if (typeof selector === 'function') {
      return selector({ skills: mockSkills })
    }
    return { skills: mockSkills }
  },
}))

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

const multimodalCatalog = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    env: [],
    models: {
      'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', attachment: true },
    },
  },
}

function baseMocks() {
  providersStore.useProvidersStore.setState({
    catalog: multimodalCatalog,
    config: { providers: {}, activeModel: { providerID: 'openai', modelID: 'gpt-4o' } },
    keyConfigured: {},
    loaded: false,
  })
  hipConfigStore.useHipConfigStore.setState({ config: { version: 1, agents: [] }, loaded: false, error: null })
  draftStore.useDraftStore.setState({ draft: null })
  vi.spyOn(domain, 'useActiveSessionId').mockReturnValue('s1')
  vi.spyOn(domain, 'useActiveSessionStatus').mockReturnValue('idle')
  vi.spyOn(domain, 'useConnectionStatus').mockReturnValue('connected')
}

function stubSession(surface: 'chat' | 'code'): SessionVM {
  return {
    id: 's1',
    config: { surface, llmProvider: 'openai', model: 'gpt-4o', tools: [] },
    title: '',
    preview: '',
    updatedAtMs: 0,
    loaded: true,
    messages: [],
    status: 'idle',
    error: null,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('InputBar slash commands', () => {
  beforeEach(() => {
    cleanup()
    vi.restoreAllMocks()
    mockSkills = []
    mockSetActiveView.mockClear()
    mockSetTab.mockClear()
    mockSetTab.mockClear()
    providersStore.useProvidersStore.setState({ catalog: {}, config: { providers: {} }, keyConfigured: {}, loaded: false })
    hipConfigStore.useHipConfigStore.setState({ config: { version: 1 }, loaded: false, error: null })
    draftStore.useDraftStore.setState({ draft: null })
  })

  it('shows built-in slash commands when typing /h and selecting /help clears input and injects message', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    // Type /h — palette should appear with /help
    fireEvent.change(textarea, { target: { value: '/h' } })

    const helpButton = screen.getByText('/help')
    expect(helpButton).toBeInTheDocument()

    // Click the /help button — should clear input (no longer injects "/help ")
    fireEvent.click(helpButton)

    // Value should now be empty (cleared by the handler)
    expect(textarea).toHaveValue('')
  })

  it('/clear command cancels and starts new conversation, then clears value', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    const cancelSpy = vi.spyOn(sessionService, 'cancel').mockReturnValue(undefined)
    const newConvSpy = vi.spyOn(sessionService, 'newConversation').mockReturnValue(undefined)

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    // Type /cle — palette shows /clear
    fireEvent.change(textarea, { target: { value: '/cle' } })

    const clearButton = screen.getByText('/clear')
    expect(clearButton).toBeInTheDocument()

    fireEvent.click(clearButton)

    expect(cancelSpy).toHaveBeenCalled()
    expect(newConvSpy).toHaveBeenCalled()
    // Value should be cleared
    expect(textarea).toHaveValue('')
  })

  it('/config command opens settings via setActiveView', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    // Type /con — palette shows /config
    fireEvent.change(textarea, { target: { value: '/con' } })

    const configButton = screen.getByText('/config')
    expect(configButton).toBeInTheDocument()

    fireEvent.click(configButton)

    expect(mockSetActiveView).toHaveBeenCalledWith('settings')
    // Value should be cleared
    expect(textarea).toHaveValue('')
  })

  it('/init command calls gitInitWorkspace and clears input', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    const gitInitSpy = vi.spyOn(sessionService, 'gitInitWorkspace').mockReturnValue(undefined)
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    // Type /in — palette shows /init
    fireEvent.change(textarea, { target: { value: '/in' } })

    const initButton = screen.getByText('/init')
    expect(initButton).toBeInTheDocument()

    fireEvent.click(initButton)

    expect(gitInitSpy).toHaveBeenCalledWith('s1')
    expect(textarea).toHaveValue('')
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('/diff command calls requestDiff and switches to changes tab', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    const requestDiffSpy = vi.spyOn(sessionService, 'requestDiff').mockReturnValue(undefined)
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    fireEvent.change(textarea, { target: { value: '/dif' } })

    const diffButton = screen.getByText('/diff')
    expect(diffButton).toBeInTheDocument()

    fireEvent.click(diffButton)

    expect(requestDiffSpy).toHaveBeenCalledWith('s1')
    expect(mockSetTab).toHaveBeenCalledWith('changes')
    expect(textarea).toHaveValue('')
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('selecting /help injects help text and clears input without sending to AI', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)
    const appendSpy = vi.spyOn(useDomainStore.getState(), 'appendMessage').mockImplementation(vi.fn())

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    fireEvent.change(textarea, { target: { value: '/h' } })

    const helpButton = screen.getByText('/help')
    expect(helpButton).toBeInTheDocument()

    fireEvent.click(helpButton)

    expect(sendSpy).not.toHaveBeenCalled()
    expect(appendSpy).toHaveBeenCalledTimes(1)
    const [sessionId, message] = appendSpy.mock.calls[0]
    expect(sessionId).toBe('s1')
    expect(message.role).toBe('assistant')
    expect(message.content).toContain('Available commands:')
    expect(message.content).toContain('/help')
    expect(message.content).toContain('/clear')
    expect(message.content).toContain('/config')
    expect(textarea).toHaveValue('')
  })

  it('does not show palette when typing normal text without slash', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: 'hello world' } })

    // No slash command text should appear
    expect(screen.queryByText('/help')).not.toBeInTheDocument()
    expect(screen.queryByText('/clear')).not.toBeInTheDocument()
    expect(screen.queryByText('/config')).not.toBeInTheDocument()
  })

  it('hides palette when slash is removed (backspace)', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    fireEvent.change(textarea, { target: { value: '/h' } })
    expect(screen.getByText('/help')).toBeInTheDocument()

    // Remove the slash
    fireEvent.change(textarea, { target: { value: '' } })
    expect(screen.queryByText('/help')).not.toBeInTheDocument()
  })

  it('skills appear in palette when loaded', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    mockSkills = [{ id: 's1', name: 'test-skill', description: 'A test skill', userInvocable: true }]

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/' } })

    expect(screen.getByText('/test-skill')).toBeInTheDocument()
    // Built-in commands should also appear
    expect(screen.getByText('/help')).toBeInTheDocument()
  })

  it('skills with userInvocable:false are hidden', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    mockSkills = [{ id: 'hidden', name: 'hidden-skill', description: 'Should be hidden', userInvocable: false }]

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/' } })

    expect(screen.queryByText('/hidden-skill')).not.toBeInTheDocument()
    // Built-in commands should still appear
    expect(screen.getByText('/help')).toBeInTheDocument()
  })

  it('skills without userInvocable field default to visible', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    mockSkills = [{ id: 'v1', name: 'visible-skill', description: 'Should be visible' }]

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/' } })

    // Skill without userInvocable field should appear (defaults to visible)
    expect(screen.getByText('/visible-skill')).toBeInTheDocument()
    expect(screen.getByText('/help')).toBeInTheDocument()
  })

  it('focus returns to textarea after selecting a skill command', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    mockSkills = [{ id: 's1', name: 'test-skill', description: 'A test skill', userInvocable: true }]

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/' } })

    // Click the skill button
    const skillButton = screen.getByText('/test-skill')
    fireEvent.click(skillButton)

    // Focus should return to textarea after the setTimeout(0)
    await waitFor(() => {
      expect(textarea).toHaveFocus()
    })
  })

  it('focus returns to textarea after Escape dismiss', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/' } })

    // Verify palette is open
    expect(screen.getByText('/help')).toBeInTheDocument()

    // Press Escape to dismiss the palette
    fireEvent.keyDown(document, { key: 'Escape' })

    // Focus should return to textarea after the setTimeout(0)
    await waitFor(() => {
      expect(textarea).toHaveFocus()
    })
  })

  it('normal text without slash is sent to the model', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    fireEvent.change(textarea, { target: { value: 'hello world' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    expect(sendSpy).toHaveBeenCalledWith('hello world', [])
  })

  it('unix-path-looking text starting with slash passes through to sendMessage', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    fireEvent.change(textarea, { target: { value: 'check /tmp/file' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    expect(sendSpy).toHaveBeenCalledWith('check /tmp/file', [])
  })

  it('empty input does not call sendMessage', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    fireEvent.change(textarea, { target: { value: '' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('slashes in the middle of text pass through to sendMessage', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    fireEvent.change(textarea, { target: { value: 'write to /etc/hosts please' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    expect(sendSpy).toHaveBeenCalledWith('write to /etc/hosts please', [])
  })

  it('keyboard ArrowDown+Enter on palette selects /compact and calls compactSession', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    const compactSpy = vi.spyOn(sessionService, 'compactSession').mockReturnValue(undefined)
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    // Type / — palette opens with all commands
    fireEvent.change(textarea, { target: { value: '/' } })
    expect(screen.getByText('/help')).toBeInTheDocument()

    // Verify first item is highlighted (activeIndex=0)
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    // Navigate to /compact (index 4, after help/clear/config/diff) with ArrowDown
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(options[4]).toHaveAttribute('aria-selected', 'true')
    expect(options[0]).toHaveAttribute('aria-selected', 'false')

    // Press Enter to select /compact
    fireEvent.keyDown(document, { key: 'Enter' })

    // /compact clears input and calls compactSession — does NOT inject text or send to AI
    expect(compactSpy).toHaveBeenCalledWith('s1')
    expect(textarea).toHaveValue('')
    expect(sendSpy).not.toHaveBeenCalled()

    // Focus should return to textarea after the setTimeout(0)
    await waitFor(() => {
      expect(textarea).toHaveFocus()
    })
  })

  it('selecting /compact calls compactSession', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    const compactSpy = vi.spyOn(sessionService, 'compactSession').mockReturnValue(undefined)
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    // Type /comp — palette shows /compact
    fireEvent.change(textarea, { target: { value: '/comp' } })

    const compactButton = screen.getByText('/compact')
    expect(compactButton).toBeInTheDocument()

    fireEvent.click(compactButton)

    expect(compactSpy).toHaveBeenCalledWith('s1')
    expect(textarea).toHaveValue('')
    expect(sendSpy).not.toHaveBeenCalled()
  })

  // ── Regression guards: /clear and /config (must not break when new branches added) ──

  it('regression: selecting /clear still calls cancel() and newConversation() and clears input', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    const cancelSpy = vi.spyOn(sessionService, 'cancel').mockReturnValue(undefined)
    const newConvSpy = vi.spyOn(sessionService, 'newConversation').mockReturnValue(undefined)
    const initSpy = vi.spyOn(sessionService, 'gitInitWorkspace').mockReturnValue(undefined)

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    // Type /cl — palette shows /clear (and NOT other commands)
    fireEvent.change(textarea, { target: { value: '/cl' } })
    const clearButton = screen.getByText('/clear')
    expect(clearButton).toBeInTheDocument()

    fireEvent.click(clearButton)

    // /clear handler: must cancel current, start new, clear value
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect(newConvSpy).toHaveBeenCalledTimes(1)
    // Must NOT call unrelated handlers
    expect(initSpy).not.toHaveBeenCalled()
    // Input must be cleared
    expect(textarea).toHaveValue('')
  })

  it('regression: selecting /config still opens settings via setActiveView("settings") and clears input', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    mockSetActiveView.mockClear()

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    // Type /co — palette shows /config
    fireEvent.change(textarea, { target: { value: '/co' } })
    const configButton = screen.getByText('/config')
    expect(configButton).toBeInTheDocument()

    fireEvent.click(configButton)

    expect(mockSetActiveView).toHaveBeenCalledTimes(1)
    expect(mockSetActiveView).toHaveBeenCalledWith('settings')
    // Input must be cleared
    expect(textarea).toHaveValue('')
  })

  it('regression: /clear and /config appear BEFORE /init, /diff, /help in palette order', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/' } })

    // Get all option texts in the order they appear in the DOM
    const options = screen.getAllByRole('option')
    const labels = options.map((opt) => opt.textContent ?? '')

    // Expected order: /help, /clear, /config, /diff, /init, /compact
    // (SlashCommandPalette builds from BUILTIN_COMMANDS array)
    const clearIdx = labels.findIndex((l) => l.includes('/clear'))
    const configIdx = labels.findIndex((l) => l.includes('/config'))
    const initIdx = labels.findIndex((l) => l.includes('/init'))
    const diffIdx = labels.findIndex((l) => l.includes('/diff'))

    // /clear and /config must be present
    expect(clearIdx).toBeGreaterThanOrEqual(0)
    expect(configIdx).toBeGreaterThanOrEqual(0)
    // /clear and /config appear before /diff and /init (the newer handlers)
    expect(clearIdx).toBeLessThan(diffIdx)
    expect(clearIdx).toBeLessThan(initIdx)
    expect(configIdx).toBeLessThan(diffIdx)
    expect(configIdx).toBeLessThan(initIdx)
  })

  it('shows all built-in commands including code-only ones in the default code session surface', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/' } })

    expect(screen.getByText('/help')).toBeInTheDocument()
    expect(screen.getByText('/clear')).toBeInTheDocument()
    expect(screen.getByText('/config')).toBeInTheDocument()
    expect(screen.getByText('/diff')).toBeInTheDocument()
    expect(screen.getByText('/init')).toBeInTheDocument()
    expect(screen.getByText('/compact')).toBeInTheDocument()
  })

  it('hides code-only commands in a chat session surface', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('chat'))

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/' } })

    expect(screen.getByText('/help')).toBeInTheDocument()
    expect(screen.getByText('/clear')).toBeInTheDocument()
    expect(screen.getByText('/config')).toBeInTheDocument()
    expect(screen.queryByText('/diff')).not.toBeInTheDocument()
    expect(screen.queryByText('/init')).not.toBeInTheDocument()
    expect(screen.queryByText('/compact')).not.toBeInTheDocument()
  })
})
