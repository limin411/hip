import { useCallback, useMemo } from 'react'
import { nanoid } from 'nanoid'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { SkillMeta } from '@hip/protocol'
import { sessionService, useDomainStore } from '@/domain'
import {
  openMemorySettings,
  runCompact,
  runDiff,
  runInit,
  extractInitFocus,
  runPlanOn,
  runPlanOff,
  runInteractive,
  runAutopilot,
  extractPlanTask,
  setIncognito,
  setUseMemories,
  toastMemoryFlagChange,
  formatMemoryStatusBody,
  showMemoryStatus,
} from '@/domain/commands'
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
  /** Skill id → enabled; missing key means enabled. */
  skillsEnabled?: Record<string, boolean>
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

/**
 * Session transcript body as Markdown so MarkdownBody renders a real list
 * (plain newlines collapse into one paragraph under react-markdown).
 */
export function formatHelpMessageBody(
  commands: SlashCommand[],
  title = 'Available commands',
): string {
  if (commands.length === 0) {
    return `**${title}**`
  }

  const lines = [`**${title}**`, '']
  for (const c of commands) {
    const desc = c.description?.trim()
    lines.push(desc ? `- \`/${c.name}\` — ${desc}` : `- \`/${c.name}\``)
  }
  return lines.join('\n')
}

/** Trailing text after `/compact` becomes summarizer focus, e.g. `/compact auth next`. */
export function extractCompactFocus(value: string): string | undefined {
  const m = value.match(/(?:^|\s)\/compact(?:\s+(.*))?$/i)
  const rest = m?.[1]?.trim()
  return rest || undefined
}

export function useSlashCommandHandler(
  surface: ComposerSurface,
  options: UseSlashCommandHandlerOptions,
) {
  const { t } = useTranslation()
  const { sessionId, skills, skillsEnabled, value, setText, inputRef, onDismiss } = options

  const availableCommands = useMemo(
    () =>
      buildCommandList(skills, {
        surface,
        sessionId,
        skillsEnabled,
        translateBuiltin: (key, fallback) => t(key, { defaultValue: fallback }),
      }),
    [skills, skillsEnabled, surface, sessionId, t],
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
          if (sessionId) {
            const focus = extractInitFocus(value)
            runInit(sessionId, focus)
          }
          setText('')
          focusInput()
          return
        }
        if (cmd.id === 'plan') {
          const task = extractPlanTask(value)
          runPlanOn(sessionId, task)
          setText('')
          focusInput()
          return
        }
        if (cmd.id === 'plan-off') {
          runPlanOff(sessionId)
          setText('')
          focusInput()
          return
        }
        if (cmd.id === 'interactive') {
          runInteractive(sessionId)
          setText('')
          focusInput()
          return
        }
        if (cmd.id === 'autopilot') {
          runAutopilot(sessionId)
          setText('')
          focusInput()
          return
        }
        if (cmd.id === 'diff') {
          if (sessionId) runDiff(sessionId)
          setText('')
          focusInput()
          return
        }
        if (cmd.id === 'compact') {
          if (sessionId) {
            const focus = extractCompactFocus(value)
            runCompact(sessionId, focus)
          }
          setText('')
          focusInput()
          return
        }
        if (cmd.id === 'help') {
          if (sessionId) {
            useDomainStore.getState().appendMessage(sessionId, {
              id: nanoid(),
              role: 'assistant',
              content: formatHelpMessageBody(
                availableCommands,
                t('chat.slash.helpTitle'),
              ),
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
        if (cmd.id === 'memory') {
          openMemorySettings()
          setText('')
          focusInput()
          return
        }
        if (cmd.id === 'memory-on') {
          if (sessionId) {
            setUseMemories(sessionId, true)
            toastMemoryFlagChange('useOn')
          }
          setText('')
          focusInput()
          return
        }
        if (cmd.id === 'memory-off') {
          if (sessionId) {
            setUseMemories(sessionId, false)
            toastMemoryFlagChange('useOff')
          }
          setText('')
          focusInput()
          return
        }
        if (cmd.id === 'memory-incognito') {
          if (sessionId) {
            setIncognito(sessionId, true)
            toastMemoryFlagChange('incognitoOn')
          }
          setText('')
          focusInput()
          return
        }
        if (cmd.id === 'memory-incognito-off') {
          if (sessionId) {
            setIncognito(sessionId, false)
            toastMemoryFlagChange('incognitoOff')
          }
          setText('')
          focusInput()
          return
        }
        if (cmd.id === 'memory-status') {
          if (sessionId) {
            const flags = formatMemoryStatusBody(sessionId)
            if (flags) {
              showMemoryStatus(sessionId, {
                title: t('chat.slash.memoryStatusTitle'),
                body: t('chat.slash.memoryStatusBody', flags),
              })
            }
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

  /** Tab completion: insert `/name ` text only — never runs the command. */
  const handleCommandComplete = useCallback(
    (cmd: SlashCommand) => {
      setText(applyCommand(cmd, value))
      focusInput()
    },
    [value, setText, focusInput],
  )

  return { handleCommandSelect, handleDismiss, handleCommandComplete }
}
