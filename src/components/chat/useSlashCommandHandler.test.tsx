// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSlashCommandHandler } from './useSlashCommandHandler'
import { sessionService, useDomainStore } from '@/domain'
import type { SkillMeta } from '@hip/protocol'
import type { SlashCommand } from './SlashCommandPalette'

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
const compactCmd: SlashCommand = { id: 'compact', name: 'compact', description: 'compact', kind: 'builtin', availableIn: ['code'], requiresSession: true }
const initCmd = codeOnly('init')

describe('useSlashCommandHandler', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockSetActiveView.mockClear()
    mockSetTab.mockClear()
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

  it('/config opens settings in chat surface', () => {
    const { result, setText } = setup('chat', null)

    result.current.handleCommandSelect(builtin('config'))

    expect(mockSetActiveView).toHaveBeenCalledWith('settings')
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/config opens settings in code surface', () => {
    const { result, setText } = setup('code', 's1')

    result.current.handleCommandSelect(builtin('config'))

    expect(mockSetActiveView).toHaveBeenCalledWith('settings')
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

    expect(compactSpy).toHaveBeenCalledWith('s1')
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/compact no-ops when sessionId is null', () => {
    const compactSpy = vi.spyOn(sessionService, 'compactSession').mockReturnValue(undefined)
    const { result, setText } = setup('code', null)

    result.current.handleCommandSelect(compactCmd)

    expect(compactSpy).not.toHaveBeenCalled()
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
    expect(message.content).toContain('/config')
    expect(message.content).not.toContain('/diff')
    expect(message.content).not.toContain('/init')
    expect(message.content).not.toContain('/compact')
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
    expect(message.content).toContain('/config')
    expect(message.content).toContain('/diff')
    expect(message.content).toContain('/init')
    expect(message.content).toContain('/compact')
    expect(setText).toHaveBeenCalledWith('')
  })

  it('/help does not append a message when sessionId is null', () => {
    const appendSpy = vi.spyOn(useDomainStore.getState(), 'appendMessage').mockImplementation(vi.fn())
    const { result, setText } = setup('chat', null)

    result.current.handleCommandSelect(builtin('help'))

    expect(appendSpy).not.toHaveBeenCalled()
    expect(setText).toHaveBeenCalledWith('')
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
