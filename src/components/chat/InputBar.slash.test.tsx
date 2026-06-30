// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { InputBar } from './InputBar'
import * as domain from '@/domain'
import { sessionService } from '@/domain'
import * as providersStore from '@/store/providersStore'
import * as hipConfigStore from '@/store/hipConfigStore'
import * as draftStore from '@/store/draftStore'

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockSetActiveView = vi.fn()

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
    (selector?: (s: { setActiveView: typeof mockSetActiveView }) => unknown) => {
      if (typeof selector === 'function') {
        return selector({ setActiveView: mockSetActiveView })
      }
      return { setActiveView: mockSetActiveView }
    },
    { getState: () => ({ setActiveView: mockSetActiveView }) },
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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('InputBar slash commands', () => {
  beforeEach(() => {
    cleanup()
    vi.restoreAllMocks()
    mockSkills = []
    mockSetActiveView.mockClear()
    providersStore.useProvidersStore.setState({ catalog: {}, config: { providers: {} }, keyConfigured: {}, loaded: false })
    hipConfigStore.useHipConfigStore.setState({ config: { version: 1 }, loaded: false, error: null })
    draftStore.useDraftStore.setState({ draft: null })
  })

  it('shows built-in slash commands when typing /h and selecting injects the command', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    // Type /h — palette should appear with /help
    fireEvent.change(textarea, { target: { value: '/h' } })

    const helpButton = screen.getByText('/help')
    expect(helpButton).toBeInTheDocument()

    // Click the /help button
    fireEvent.click(helpButton)

    // Value should now be "/help "
    expect(textarea).toHaveValue('/help ')
  })

  it('/clear command cancels and starts new conversation, then clears value', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)
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
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)

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

  it('does not show palette when typing normal text without slash', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)

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
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)

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
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)
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
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)
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
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)
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
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)
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
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)

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

  it('keyboard ArrowDown+Enter on palette selects command and injects text', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    // Type / — palette opens with all commands
    fireEvent.change(textarea, { target: { value: '/' } })
    expect(screen.getByText('/help')).toBeInTheDocument()

    // Verify first item is highlighted (activeIndex=0)
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    // Navigate to /diff (index 3, after help/clear/config) with ArrowDown
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(options[3]).toHaveAttribute('aria-selected', 'true')
    expect(options[0]).toHaveAttribute('aria-selected', 'false')

    // Press Enter to select /diff
    fireEvent.keyDown(document, { key: 'Enter' })

    // /diff injects "/diff " into the input (non-clearing builtin command)
    expect(textarea).toHaveValue('/diff ')

    // Focus should return to textarea after the setTimeout(0)
    await waitFor(() => {
      expect(textarea).toHaveFocus()
    })
  })
})
