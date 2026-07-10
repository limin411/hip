import { useCallback, useMemo } from 'react'
import { nanoid } from 'nanoid'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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

const HELP_TOAST_MAX = 12

/** Toast body: command names only, capped for small toast surface. */
export function formatHelpToastBody(commands: SlashCommand[]): string {
  const names = commands.map((c) => `/${c.name}`)
  if (names.length <= HELP_TOAST_MAX) return names.join('\n')
  const head = names.slice(0, HELP_TOAST_MAX)
  const rest = names.length - HELP_TOAST_MAX
  return [...head, `+${rest} more`].join('\n')
}

/** Session transcript body: full name — description list. */
export function formatHelpMessageBody(commands: SlashCommand[]): string {
  const lines = ['Available commands:']
  for (const c of commands) {
    lines.push(`/${c.name} — ${c.description}`)
  }
  return lines.join('\n')
}

export function useSlashCommandHandler(
  surface: ComposerSurface,
  options: UseSlashCommandHandlerOptions,
) {
  const { t } = useTranslation()
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
          if (sessionId) {
            useDomainStore.getState().appendMessage(sessionId, {
              id: nanoid(),
              role: 'assistant',
              content: formatHelpMessageBody(availableCommands),
              timestamp: Date.now(),
            })
          } else {
            toast.message(t('chat.slash.helpTitle'), {
              description: formatHelpToastBody(availableCommands),
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
    [availableCommands, sessionId, value, setText, focusInput, t],
  )

  const handleDismiss = useCallback(() => {
    if (extractSlashQuery(value) === null) {
      onDismiss?.()
      return
    }
    const m = value.match(/^((?:.*\s)?)\/[^\s/]*$/)
    setText(m ? m[1] : '')
    focusInput()
    onDismiss?.()
  }, [value, setText, focusInput, onDismiss])

  return { handleCommandSelect, handleDismiss }
}
