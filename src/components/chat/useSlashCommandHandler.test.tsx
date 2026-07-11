// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  formatHelpToastBody,
  useSlashCommandHandler,
} from './useSlashCommandHandler'
import { sessionService, useDomainStore } from '@/domain'
import type { SkillMeta } from '@hip/protocol'
import type { SlashCommand } from './SlashCommandPalette'
import '@/i18n'

const mockSetActiveView = vi.fn()
const mockSetTab = vi.fn()
const mockSetSettingsPage = vi.fn()
const toastMessage = vi.fn()

vi.mock('sonner', () => ({
  toast: { message: (...args: unknown[]) => toastMessage(...args) },
  Toaster: () => null,
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: Object.assign(
    (selector?: (s: {
      setActiveView: typeof mockSetActiveView
      setTab: typeof mockSetTab
      setSettingsPage: typeof mockSetSettingsPage
    }) => unknown) => {
      if (typeof selector === 'function') {
        return selector({
          setActiveView: mockSetActiveView,
          setTab: mockSetTab,
          setSettingsPage: mockSetSettingsPage,
        })
      }
      return {
        setActiveView: mockSetActiveView,
        setTab: mockSetTab,
        setSettingsPage: mockSetSettingsPage,
      }
    },
    {
      getState: () => ({
        setActiveView: mockSetActiveView,
        setTab: mockSetTab,
        setSettingsPage: mockSetSettingsPage,
      }),
    },
  ),
}))

function setup(
  surface: 'chat' | 'code',
  sessionId: string | null,
  { skills = [], value = '' }: { skills?: SkillMeta[]; value?: string } = {},
) {
  const setText = vi.fn()
  const textarea = document.createElement('textarea')
  textarea.value = value
  const inputRef = { current: textarea }
  const onDismiss = vi.fn()
  const { result } = renderHook(() =>
    useSlashCommandHandler(surface, {
      sessionId,
      skills,
      value,
      setText,
      inputRef,
      onDismiss,
    }),
  )
  return { result, setText, inputRef, onDismiss }
}

const builtin = (id: string): SlashCommand =>
  ({ id, name: id, description: id, kind: 'builtin', availableIn: ['chat', 'code'] } as SlashCommand)

const codeOnly = (id: string): SlashCommand =>
  ({ id, name: id, description: id, kind: 'builtin', availableIn: ['code'] } as SlashCommand)

const diffCmd = codeOnly('diff')
const compactCmd: SlashCommand = { id: 'compact', name: 'compact', description: 'compact', kind: 'builtin', availableIn: ['chat', 'code'], requiresSession: true }
const initCmd = codeOnly('init')

describe('useSlashCommandHandler', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockSetActiveView.mockClear()
    mockSetTab.mockClear()
    mockSetSettingsPage.mockClear()
    toastMessage.mockClear()
  })

  it('/clear cancels and starts a new conversation in chat surface', () => {
    const cancelSpy = vi.spyOn(sessionService, 'cancel').mockReturnValue(undefined)
    const newConvSpy = vi.spyOn(sessionService, 'newConversation').mockReturnValue(undefined)
    const { result, setText } = setup('chat', null)

    result.current.handleCommandSelect(builtin('clear'))

    expect(cancelSpy).toHaveBeenCalled()
    expect(newConvSpy).toHaveBeenCalled()
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/clear works the same in code surface', () => {
    const cancelSpy = vi.spyOn(sessionService, 'cancel').mockReturnValue(undefined)
    const newConvSpy = vi.spyOn(sessionService, 'newConversation').mockReturnValue(undefined)
    const { result, setText } = setup('code', 's1')

    result.current.handleCommandSelect(builtin('clear'))

    expect(cancelSpy).toHaveBeenCalled()
    expect(newConvSpy).toHaveBeenCalled()
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/config is no longer a builtin (removed in favor of global palette Settings)', () => {
    const { result, setText } = setup('chat', null)

    result.current.handleCommandSelect(builtin('config'))

    // Guard: unavailable commands only clear input
    expect(mockSetActiveView).not.toHaveBeenCalled()
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/init calls gitInitWorkspace in code surface when sessionId is present', () => {
    const initSpy = vi.spyOn(sessionService, 'gitInitWorkspace').mockReturnValue(undefined)
    const { result, setText } = setup('code', 's1')

    result.current.handleCommandSelect(initCmd)

    expect(initSpy).toHaveBeenCalledWith('s1')
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/init no-ops when sessionId is null', () => {
    const initSpy = vi.spyOn(sessionService, 'gitInitWorkspace').mockReturnValue(undefined)
    const { result, setText } = setup('code', null)

    result.current.handleCommandSelect(initCmd)

    expect(initSpy).not.toHaveBeenCalled()
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/diff in chat surface is not reachable and only clears input', () => {
    const requestDiffSpy = vi.spyOn(sessionService, 'requestDiff').mockReturnValue(undefined)
    const { result, setText } = setup('chat', 's1')

    result.current.handleCommandSelect(diffCmd)

    expect(requestDiffSpy).not.toHaveBeenCalled()
    expect(mockSetTab).not.toHaveBeenCalled()
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/diff in code surface calls requestDiff and switches to changes tab', () => {
    const requestDiffSpy = vi.spyOn(sessionService, 'requestDiff').mockReturnValue(undefined)
    const { result, setText } = setup('code', 's1')

    result.current.handleCommandSelect(diffCmd)

    expect(requestDiffSpy).toHaveBeenCalledWith('s1')
    expect(mockSetTab).toHaveBeenCalledWith('changes')
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/compact in code surface calls compactSession when sessionId is present', () => {
    const compactSpy = vi.spyOn(sessionService, 'compactSession').mockReturnValue(undefined)
    const { result, setText } = setup('code', 's1')

    result.current.handleCommandSelect(compactCmd)

    expect(compactSpy).toHaveBeenCalledWith('s1', undefined)
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/compact with trailing focus forwards focus string', () => {
    const compactSpy = vi.spyOn(sessionService, 'compactSession').mockReturnValue(undefined)
    const { result } = setup('chat', 's1', { value: '/compact auth middleware' })

    result.current.handleCommandSelect(compactCmd)

    expect(compactSpy).toHaveBeenCalledWith('s1', 'auth middleware')
  })

  it('/compact no-ops when sessionId is null', () => {
    const compactSpy = vi.spyOn(sessionService, 'compactSession').mockReturnValue(undefined)
    const { result, setText } = setup('code', null)

    result.current.handleCommandSelect(compactCmd)

    expect(compactSpy).not.toHaveBeenCalled()
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/memory opens settings on the memory page', () => {
    const { result, setText } = setup('chat', null)

    result.current.handleCommandSelect(builtin('memory'))

    expect(mockSetSettingsPage).toHaveBeenCalledWith('memory')
    expect(mockSetActiveView).toHaveBeenCalledWith('settings')
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/memory-on sets useMemories true for the session', () => {
    const spy = vi.spyOn(sessionService, 'setMemoryFlags').mockReturnValue(undefined)
    const { result, setText } = setup('chat', 's1')

    result.current.handleCommandSelect(builtin('memory-on'))

    expect(spy).toHaveBeenCalledWith('s1', { useMemories: true })
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/memory-off sets useMemories false for the session', () => {
    const spy = vi.spyOn(sessionService, 'setMemoryFlags').mockReturnValue(undefined)
    const { result, setText } = setup('chat', 's1')

    result.current.handleCommandSelect(builtin('memory-off'))

    expect(spy).toHaveBeenCalledWith('s1', { useMemories: false })
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/memory-incognito sets incognito true for the session', () => {
    const spy = vi.spyOn(sessionService, 'setMemoryFlags').mockReturnValue(undefined)
    const { result, setText } = setup('chat', 's1')

    result.current.handleCommandSelect(builtin('memory-incognito'))

    expect(spy).toHaveBeenCalledWith('s1', { incognito: true })
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/help lists only commands available in chat surface', () => {
    const appendSpy = vi.spyOn(useDomainStore.getState(), 'appendMessage').mockImplementation(vi.fn())
    const { result, setText } = setup('chat', 's1')

    result.current.handleCommandSelect(builtin('help'))

    expect(appendSpy).toHaveBeenCalledTimes(1)
    const [, message] = appendSpy.mock.calls[0]
    expect(message.content).toContain('/help')
    expect(message.content).toContain('/clear')
    expect(message.content).not.toContain('/config')
    expect(message.content).not.toContain('/diff')
    expect(message.content).not.toContain('/init')
    expect(message.content).toContain('/compact')
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/help lists all builtins in code surface with a session', () => {
    const appendSpy = vi.spyOn(useDomainStore.getState(), 'appendMessage').mockImplementation(vi.fn())
    const { result, setText } = setup('code', 's1')

    result.current.handleCommandSelect(builtin('help'))

    expect(appendSpy).toHaveBeenCalledTimes(1)
    const [, message] = appendSpy.mock.calls[0]
    expect(message.content).toContain('/help')
    expect(message.content).toContain('/clear')
    expect(message.content).not.toContain('/config')
    expect(message.content).toContain('/diff')
    expect(message.content).toContain('/init')
    expect(message.content).toContain('/compact')
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/help does not append a message when sessionId is null and shows toast', () => {
    const appendSpy = vi.spyOn(useDomainStore.getState(), 'appendMessage').mockImplementation(vi.fn())
    const { result, setText } = setup('chat', null)

    result.current.handleCommandSelect(builtin('help'))

    expect(appendSpy).not.toHaveBeenCalled()
    expect(toastMessage).toHaveBeenCalledTimes(1)
    const [title, opts] = toastMessage.mock.calls[0]
    expect(title).toBe('Available commands')
    expect(opts.description).toContain('/help')
    expect(opts.description).toContain('/clear')
    expect(opts.description).not.toContain('/config')
    expect(opts.description).not.toContain(' — ')
    expect(setText).toHaveBeenCalledWith('')
  })

  it('formatHelpToastBody caps at 12 names and appends +N more', () => {
    const many: SlashCommand[] = Array.from({ length: 15 }, (_, i) => ({
      id: `c${i}`,
      name: `cmd${i}`,
      description: `desc ${i}`,
      kind: 'skill',
      availableIn: ['chat', 'code'],
    }))
    const body = formatHelpToastBody(many)
    expect(body.split('\n')).toHaveLength(13)
    expect(body).toContain('/cmd0')
    expect(body).toContain('/cmd11')
    expect(body).not.toContain('/cmd12')
    expect(body).toContain('+3 more')
    expect(body).not.toContain(' — ')
  })

  it('skill commands apply the command text and refocus', () => {
    const skill: SkillMeta = {
      id: 'skill-1',
      name: 'my-skill',
      description: 'A skill',
      dir: '/tmp/skills/skill-1',
      hasScripts: false,
    }
    const slashSkill: SlashCommand = {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      kind: 'skill',
      availableIn: ['chat', 'code'],
    }
    const { result, setText, inputRef } = setup('chat', 's1', { skills: [skill], value: 'do /my' })

    result.current.handleCommandSelect(slashSkill)

    expect(setText).toHaveBeenCalledWith('do /my-skill ')
    expect(inputRef.current.value).toBe('do /my')
  })

  it('handleDismiss strips the active slash query and calls onDismiss', () => {
    const { result, setText, onDismiss } = setup('chat', 's1', { value: 'foo /bar' })

    result.current.handleDismiss()

    expect(setText).toHaveBeenCalledWith('foo ')
    expect(onDismiss).toHaveBeenCalled()
  })

  it('handleDismiss clears the whole value when slash is at the start', () => {
    const { result, setText } = setup('chat', 's1', { value: '/bar' })

    result.current.handleDismiss()

    expect(setText).toHaveBeenCalledWith('')
  })

  it('handleDismiss calls onDismiss without modifying text when no slash query is present', () => {
    const { result, setText, onDismiss } = setup('chat', 's1', { value: 'hello world' })

    result.current.handleDismiss()

    expect(setText).not.toHaveBeenCalled()
    expect(onDismiss).toHaveBeenCalled()
  })
})
