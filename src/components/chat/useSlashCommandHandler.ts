import { useCallback, useMemo } from 'react'
import { nanoid } from 'nanoid'
import type { SkillMeta } from '@hip/protocol'
import { sessionService, useDomainStore } from '@/domain'
import { useUiStore } from '@/store/uiStore'
import {
  applyCommand,
  buildCommandList,
  extractSlashQuery,
  type ComposerSurface,
  type SlashCommand,
} from './SlashCommandPalette'

export interface UseSlashCommandHandlerOptions {
  sessionId: string | null
  skills: SkillMeta[]
  value: string
  setText: (value: string) => void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  onDismiss?: () => void
}

export function useSlashCommandHandler(
  surface: ComposerSurface,
  options: UseSlashCommandHandlerOptions,
) {
  const { sessionId, skills, value, setText, inputRef, onDismiss } = options

  const availableCommands = useMemo(
    () => buildCommandList(skills, { surface, sessionId }),
    [skills, surface, sessionId],
  )

  const focusInput = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [inputRef])

  const handleCommandSelect = useCallback(
    (cmd: SlashCommand) => {
      // The palette already filters by surface/session, but guard programmatic
      // invocations (e.g. tests or future callers) against unavailable commands.
      if (!availableCommands.some((c) => c.id === cmd.id && c.kind === cmd.kind)) {
        setText('')
        focusInput()
        return
      }

      if (cmd.kind === 'builtin') {
        if (cmd.id === 'clear') {
          sessionService.cancel()
          sessionService.newConversation()
          setText('')
          focusInput()
          return
        }
        if (cmd.id === 'config') {
          useUiStore.getState().setActiveView('settings')
          setText('')
          focusInput()
          return
        }
        if (cmd.id === 'init') {
          if (sessionId) sessionService.gitInitWorkspace(sessionId)
          setText('')
          focusInput()
          return
        }
        if (cmd.id === 'diff') {
          if (sessionId) {
            sessionService.requestDiff(sessionId)
            useUiStore.getState().setTab('changes')
          }
          setText('')
          focusInput()
          return
        }
        if (cmd.id === 'compact') {
          if (sessionId) sessionService.compactSession(sessionId)
          setText('')
          focusInput()
          return
        }
        if (cmd.id === 'help') {
          const lines = ['Available commands:']
          for (const c of availableCommands) {
            lines.push(`/${c.name} — ${c.description}`)
          }
          const helpText = lines.join('\n')
          if (sessionId) {
            useDomainStore.getState().appendMessage(sessionId, {
              id: nanoid(),
              role: 'assistant',
              content: helpText,
              timestamp: Date.now(),
            })
          }
          setText('')
          focusInput()
          return
        }
      }

      setText(applyCommand(cmd, value))
      focusInput()
    },
    [availableCommands, sessionId, value, setText, focusInput],
  )

  const handleDismiss = useCallback(() => {
    if (extractSlashQuery(value) === null) {
      onDismiss?.()
      return
    }
    const m = value.match(/^((?:.*\s)?)\/\S*$/)
    setText(m ? m[1] : '')
    focusInput()
    onDismiss?.()
  }, [value, setText, focusInput, onDismiss])

  return { handleCommandSelect, handleDismiss }
}
