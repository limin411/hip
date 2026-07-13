// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { InputBar } from './InputBar'
import * as domain from '@/domain'
import { sessionService, useDomainStore } from '@/domain'
import type { SessionVM } from '@/domain'
import type { SkillMeta } from '@hip/protocol'
import * as providersStore from '@/store/providersStore'
import * as hipConfigStore from '@/store/hipConfigStore'
import * as draftStore from '@/store/draftStore'

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockSetActiveView = vi.fn()
const mockSetTab = vi.fn()

const fixturePluginDir = path.resolve(import.meta.dirname, '../../../e2e/fixtures/sample-plugin')

function readFixtureSkillMeta(skillName: string): SkillMeta {
  const dir = path.join(fixturePluginDir, 'skills', skillName)
  const raw = readFileSync(path.join(dir, 'SKILL.md'), 'utf8')
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const frontmatter = frontmatterMatch ? frontmatterMatch[1] : ''
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1].trim() ?? skillName
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1].trim() ?? skillName
  return {
    id: skillName,
    name,
    description,
    dir,
    hasScripts: false,
    scope: 'plugin',
    pluginId: 'sample-plugin',
    userInvocable: true,
  }
}

// eslint-disable-next-line no-var
var mockSkills: SkillMeta[] = []

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

function stubSession(surface: 'chat' | 'code', cwd?: string): SessionVM {
  return {
    id: 's1',
    config: {
      surface,
      llmProvider: 'openai',
      model: 'gpt-4o',
      tools: [],
      ...(cwd ? { cwd } : {}),
    },
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

  it('/config is no longer offered in the slash palette', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/con' } })

    expect(screen.queryByText('/config')).not.toBeInTheDocument()
    expect(mockSetActiveView).not.toHaveBeenCalled()
  })

  it('/init command sends AGENTS.md init prompt and clears input', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code', '/tmp/proj'))
    useDomainStore.setState({ sessions: [], activeSessionId: null, connection: 'disconnected' })
    useDomainStore.getState().createSession('s1', {
      surface: 'code',
      llmProvider: 'openai',
      model: 'gpt-4o',
      tools: [],
      cwd: '/tmp/proj',
    })
    const gitInitSpy = vi.spyOn(sessionService, 'gitInitWorkspace').mockReturnValue(undefined)
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')

    // Type /in — palette shows /init
    fireEvent.change(textarea, { target: { value: '/in' } })

    const initButton = screen.getByText('/init')
    expect(initButton).toBeInTheDocument()

    fireEvent.click(initButton)

    expect(gitInitSpy).not.toHaveBeenCalled()
    expect(sendSpy).toHaveBeenCalled()
    expect(sendSpy.mock.calls[0][0]).toContain('AGENTS.md')
    expect(textarea).toHaveValue('')
  })

  it('/diff command calls requestDiff and switches to changes tab', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    const requestDiffSpy = vi.spyOn(sessionService, 'requestDiff').mockReturnValue('sent')
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
    expect(message.content).toContain('**Available commands**')
    expect(message.content).toContain('/help')
    expect(message.content).toContain('/clear')
    expect(message.content).not.toContain('/config')
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
    mockSkills = [{ id: 's1', name: 'test-skill', description: 'A test skill', userInvocable: true, dir: '/tmp/skills/test-skill', hasScripts: false }]

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
    mockSkills = [{ id: 'hidden', name: 'hidden-skill', description: 'Should be hidden', userInvocable: false, dir: '/tmp/skills/hidden-skill', hasScripts: false }]

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
    mockSkills = [{ id: 'v1', name: 'visible-skill', description: 'Should be visible', dir: '/tmp/skills/visible-skill', hasScripts: false }]

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
    mockSkills = [{ id: 's1', name: 'test-skill', description: 'A test skill', userInvocable: true, dir: '/tmp/skills/test-skill', hasScripts: false }]

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

    // Navigate to /compact (index 3, after help/clear/diff) with ArrowDown
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    // Re-query after keyboard updates
    const afterNav = screen.getAllByRole('option')
    expect(afterNav[3]).toHaveAttribute('aria-selected', 'true')
    expect(afterNav[0]).toHaveAttribute('aria-selected', 'false')

    // Press Enter to select /compact
    fireEvent.keyDown(document, { key: 'Enter' })

    // /compact clears input and calls compactSession — does NOT inject text or send to AI
    expect(compactSpy).toHaveBeenCalledWith('s1', undefined)
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

    expect(compactSpy).toHaveBeenCalledWith('s1', undefined)
    expect(textarea).toHaveValue('')
    expect(sendSpy).not.toHaveBeenCalled()
  })

  // ── Regression guards: /clear (must not break when new branches added) ──

  it('regression: selecting /clear still calls cancel() and newConversation() and clears input', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    const cancelSpy = vi.spyOn(sessionService, 'cancel').mockReturnValue(undefined)
    const newConvSpy = vi.spyOn(sessionService, 'newConversation').mockReturnValue(undefined)
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)

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
    expect(sendSpy).not.toHaveBeenCalled()
    // Input must be cleared
    expect(textarea).toHaveValue('')
  })

  it('regression: /clear appears BEFORE /diff and /init; /config is absent', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/' } })

    // Get all option texts in the order they appear in the DOM
    const options = screen.getAllByRole('option')
    const labels = options.map((opt) => opt.textContent ?? '')

    // Expected order: /help, /clear, /diff, /compact, /init
    const clearIdx = labels.findIndex((l) => l.includes('/clear'))
    const initIdx = labels.findIndex((l) => l.includes('/init'))
    const diffIdx = labels.findIndex((l) => l.includes('/diff'))
    const configIdx = labels.findIndex((l) => l.includes('/config'))

    expect(clearIdx).toBeGreaterThanOrEqual(0)
    expect(configIdx).toBe(-1)
    expect(clearIdx).toBeLessThan(diffIdx)
    expect(clearIdx).toBeLessThan(initIdx)
  })

  it('shows all built-in commands including code-only ones in the default code session surface', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/' } })

    expect(screen.getByText('/help')).toBeInTheDocument()
    expect(screen.getByText('/clear')).toBeInTheDocument()
    expect(screen.queryByText('/config')).not.toBeInTheDocument()
    expect(screen.getByText('/diff')).toBeInTheDocument()
    expect(screen.getByText('/init')).toBeInTheDocument()
    expect(screen.getByText('/compact')).toBeInTheDocument()
  })

  it('hides code-only commands in a chat session surface but shows compact', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('chat'))

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/' } })

    expect(screen.getByText('/help')).toBeInTheDocument()
    expect(screen.getByText('/clear')).toBeInTheDocument()
    expect(screen.queryByText('/config')).not.toBeInTheDocument()
    expect(screen.queryByText('/diff')).not.toBeInTheDocument()
    expect(screen.queryByText('/init')).not.toBeInTheDocument()
    expect(screen.getByText('/compact')).toBeInTheDocument()
  })

  it('regression: selecting fixture skill /sample-greet injects "/sample-greet " into composer', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    mockSkills = [readFixtureSkillMeta('sample-greet')]

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/' } })

    const skillButton = screen.getByText('/sample-greet')
    expect(skillButton).toBeInTheDocument()

    fireEvent.click(skillButton)

    await waitFor(() => {
      expect(textarea).toHaveValue('/sample-greet ')
    })
  })

  it('shows empty state for unmatched slash query and Enter does not sendMessage', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(stubSession('code'))
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)

    render(<InputBar />)

    const textarea = screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)')
    fireEvent.change(textarea, { target: { value: '/zzz' } })

    expect(screen.getByTestId('slash-palette-empty')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Enter' })

    expect(sendSpy).not.toHaveBeenCalled()
    expect(textarea).toHaveValue('/zzz')
  })
})
