// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { InputBar } from './InputBar'
import * as providersStore from '@/store/providersStore'
import * as hipConfigStore from '@/store/hipConfigStore'
import * as draftStore from '@/store/draftStore'
import * as domain from '@/domain'
import { sessionService } from '@/domain'
import { useDomainStore } from '@/domain/sessionStore'
import { pickAttachmentFiles } from '@/ipc/dialog'
import {
  insertComposerText,
  replaceComposerText,
  registerComposerHandlers,
  setComposerQuote,
} from '@/components/command-palette/composerBridge'

vi.mock('@/store/skillsStore', () => ({
  useSkillsStore: (selector?: (s: { skills: never[] }) => unknown) => {
    if (typeof selector === 'function') return selector({ skills: [] })
    return { skills: [] }
  },
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: Object.assign(
    (selector?: (s: { setActiveView: () => void }) => unknown) => {
      if (typeof selector === 'function') return selector({ setActiveView: vi.fn() })
      return { setActiveView: vi.fn() }
    },
    { getState: () => ({ setActiveView: vi.fn() }) },
  ),
}))

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

describe('InputBar', () => {
  beforeEach(() => {
    cleanup()
    vi.restoreAllMocks()
    registerComposerHandlers(null)
    providersStore.useProvidersStore.setState({ catalog: {}, config: { providers: {} }, keyConfigured: {}, loaded: false })
    hipConfigStore.useHipConfigStore.setState({ config: { version: 1 }, loaded: false, error: null })
    draftStore.useDraftStore.setState({ draft: null })
  })

  it('insertComposerText preserves existing draft (does not replace)', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)

    render(<InputBar />)
    const ta = screen.getByPlaceholderText(
      'Message hip… (Enter to send, Shift+Enter for newline)',
    ) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'draft in progress' } })
    expect(ta).toHaveValue('draft in progress')

    // Place caret at end so insert appends.
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)

    const ok = insertComposerText('> quoted\n\n')
    expect(ok).toBe(true)
    await vi.waitFor(() => {
      expect(ta).toHaveValue('draft in progress> quoted\n\n')
    })
  })

  it('replaceComposerText replaces the entire composer (skill handoff)', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)

    render(<InputBar />)
    const ta = screen.getByPlaceholderText(
      'Message hip… (Enter to send, Shift+Enter for newline)',
    ) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'old draft' } })

    expect(replaceComposerText('/pdf ')).toBe(true)
    await vi.waitFor(() => {
      expect(ta).toHaveValue('/pdf ')
    })
  })

  it('setComposerQuote shows a chip without dumping text into the textarea', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockImplementation(() => {})

    render(<InputBar />)
    const ta = screen.getByPlaceholderText(
      'Message hip… (Enter to send, Shift+Enter for newline)',
    ) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'my reply' } })

    expect(setComposerQuote('quoted\nmessage body')).toBe(true)
    await vi.waitFor(() => {
      expect(screen.getByTestId('composer-quote')).toBeInTheDocument()
    })
    expect(screen.getByTestId('composer-quote')).toHaveTextContent('quoted message body')
    expect(ta).toHaveValue('my reply')

    fireEvent.click(screen.getByTestId('composer-send'))
    expect(sendSpy).toHaveBeenCalledWith('> quoted\n> message body\n\nmy reply', [])
    expect(screen.queryByTestId('composer-quote')).not.toBeInTheDocument()
    expect(ta).toHaveValue('')
  })

  it('composer quote remove clears the chip', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)

    render(<InputBar />)
    expect(setComposerQuote('keep this short')).toBe(true)
    await vi.waitFor(() => {
      expect(screen.getByTestId('composer-quote')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('composer-quote-remove'))
    expect(screen.queryByTestId('composer-quote')).not.toBeInTheDocument()
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

  it('does not switch model before sending an image attachment when a vision agent exists', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)
    hipConfigStore.useHipConfigStore.setState({
      config: {
        version: 1,
        agents: [
          { id: 'a1', name: 'Vision', kind: 'internal', command: '', args: [], enabled: true, boundModel: { providerID: 'openai', modelID: 'gpt-4o' }, prompt: '' },
        ],
      },
    })
    vi.mocked(pickAttachmentFiles).mockResolvedValue(['/path/to/image.png'])
    const setSessionModel = vi.spyOn(sessionService, 'setSessionModel').mockReturnValue(undefined)
    const sendMessage = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)

    render(<InputBar />)
    fireEvent.click(screen.getByTestId('attachment-button'))
    await vi.waitFor(() => {
      expect(screen.getByTestId('attachment-chip')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)'), { target: { value: 'describe this' } })
    fireEvent.click(screen.getByTestId('composer-send'))

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith('describe this', expect.any(Array))
    })
    expect(setSessionModel).not.toHaveBeenCalled()
  })

  it('does not switch the draft model before sending an image attachment', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSessionId').mockReturnValue(null)
    vi.spyOn(domain, 'useActiveSession').mockReturnValue(null as any)
    vi.spyOn(hipConfigStore, 'useHipConfigStore').mockImplementation((selector: any) =>
      selector({
        config: {
          agents: [
            { id: 'a1', name: 'Vision', kind: 'internal', command: '', args: [], enabled: true, boundModel: { providerID: 'openai', modelID: 'gpt-4o' }, prompt: '' },
          ],
        },
      }),
    )
    draftStore.useDraftStore.setState({ draft: { tempId: 'd1', mode: 'chat', text: '', modelKey: 'openai/gpt-4' } })
    const setModelKey = vi.spyOn(draftStore.useDraftStore.getState(), 'setModelKey').mockReturnValue(undefined)
    vi.mocked(pickAttachmentFiles).mockResolvedValue(['/path/to/image.png'])
    const sendMessage = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)

    render(<InputBar />)
    fireEvent.click(screen.getByTestId('attachment-button'))
    await vi.waitFor(() => {
      expect(screen.getByTestId('attachment-chip')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)'), { target: { value: 'describe this' } })
    fireEvent.click(screen.getByTestId('composer-send'))

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith('describe this', expect.any(Array))
    })
    expect(setModelKey).not.toHaveBeenCalled()
  })

  it('does not switch model when the active session model is already multimodal', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)
    vi.mocked(pickAttachmentFiles).mockResolvedValue(['/path/to/image.png'])
    const setSessionModel = vi.spyOn(sessionService, 'setSessionModel').mockReturnValue(undefined)
    const sendMessage = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)

    render(<InputBar />)
    fireEvent.click(screen.getByTestId('attachment-button'))
    await vi.waitFor(() => {
      expect(screen.getByTestId('attachment-chip')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('composer-send'))

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalled()
    })
    expect(setSessionModel).not.toHaveBeenCalled()
  })

  it('does not switch model before resuming an interrupt with an image attachment', async () => {
    baseMocks()
    useDomainStore.setState({
      sessions: [{
        id: 's1',
        config: { llmProvider: 'openai', model: 'gpt-4', tools: [] },
        title: 'T',
        preview: 'P',
        updatedAtMs: 0,
        loaded: true,
        messages: [],
        status: 'idle',
        error: null,
        interrupt: { turnId: 't1', question: 'need more info' },
      }],
      activeSessionId: 's1',
    })
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4', tools: [] },
      title: '',
      preview: '',
      messages: [],
      interrupt: { turnId: 't1', question: 'need more info' },
    } as any)
    hipConfigStore.useHipConfigStore.setState({
      config: {
        version: 1,
        agents: [
          { id: 'a1', name: 'Vision', kind: 'internal', command: '', args: [], enabled: true, boundModel: { providerID: 'openai', modelID: 'gpt-4o' }, prompt: '' },
        ],
      },
    })
    vi.mocked(pickAttachmentFiles).mockResolvedValue(['/path/to/image.png'])
    const setSessionModel = vi.spyOn(sessionService, 'setSessionModel').mockReturnValue(undefined)
    const resume = vi.spyOn(sessionService, 'resume').mockReturnValue(undefined)

    render(<InputBar />)
    fireEvent.click(screen.getByTestId('attachment-button'))
    await vi.waitFor(() => {
      expect(screen.getByTestId('attachment-chip')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByPlaceholderText('Message hip… (Enter to send, Shift+Enter for newline)'), { target: { value: 'here is the image' } })
    fireEvent.click(screen.getByTestId('composer-send'))

    await vi.waitFor(() => {
      expect(resume).toHaveBeenCalledWith('here is the image', expect.any(Array))
    })
    expect(setSessionModel).not.toHaveBeenCalled()
  })

  it('does not switch model for non-image attachments when the current model is not multimodal', async () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)
    hipConfigStore.useHipConfigStore.setState({
      config: {
        version: 1,
        agents: [
          { id: 'a1', name: 'Vision', kind: 'internal', command: '', args: [], enabled: true, boundModel: { providerID: 'openai', modelID: 'gpt-4o' }, prompt: '' },
        ],
      },
    })
    vi.mocked(pickAttachmentFiles).mockResolvedValue(['/path/to/doc.pdf'])
    const setSessionModel = vi.spyOn(sessionService, 'setSessionModel').mockReturnValue(undefined)
    const sendMessage = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)

    render(<InputBar />)
    fireEvent.click(screen.getByTestId('attachment-button'))
    await vi.waitFor(() => {
      expect(screen.getByTestId('attachment-chip')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('composer-send'))

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalled()
    })
    expect(setSessionModel).not.toHaveBeenCalled()
  })

  it('exposes a top drag handle that resizes the textarea height', () => {
    baseMocks()
    vi.spyOn(domain, 'useActiveSession').mockReturnValue({
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-4o', tools: [] },
      title: '',
      preview: '',
      messages: [],
    } as any)

    render(<InputBar />)
    const handle = screen.getByTestId('input-bar-resize')
    const ta = screen.getByPlaceholderText(
      'Message hip… (Enter to send, Shift+Enter for newline)',
    ) as HTMLTextAreaElement

    const startH = parseInt(ta.style.height || '56', 10) || 56
    fireEvent.pointerDown(handle, { button: 0, clientY: 400 })
    fireEvent.pointerMove(window, { clientY: 360 })
    fireEvent.pointerUp(window, { button: 0, clientY: 360 })

    const nextH = parseInt(ta.style.height || '0', 10)
    expect(nextH).toBeGreaterThan(startH)
  })
})
