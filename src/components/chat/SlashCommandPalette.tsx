import { useMemo, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { SkillMeta } from '@hip/protocol'

export type ComposerSurface = 'chat' | 'code'

/** One command shown in the palette. */
export interface SlashCommand {
  id: string
  name: string
  description: string
  kind: 'builtin' | 'skill' | 'mcp-prompt'
  availableIn: ('chat' | 'code')[]
  requiresSession?: boolean
  onSelect?: () => void
}

/** Built-in slash commands. */
export const BUILTIN_COMMANDS: SlashCommand[] = [
  { id: 'help', name: 'help', description: 'Show available commands', kind: 'builtin', availableIn: ['chat', 'code'] },
  { id: 'clear', name: 'clear', description: 'Start a new conversation', kind: 'builtin', availableIn: ['chat', 'code'] },
  // /config removed: open Settings via global command palette (⌘K → Settings).
  { id: 'diff', name: 'diff', description: 'Show workspace changes', kind: 'builtin', availableIn: ['code'] },
  { id: 'compact', name: 'compact', description: 'Summarize conversation to save context', kind: 'builtin', availableIn: ['code'], requiresSession: true },
  { id: 'init', name: 'init', description: 'Initialize a new project', kind: 'builtin', availableIn: ['code'] },
  { id: 'memory', name: 'memory', description: 'Open Memory settings', kind: 'builtin', availableIn: ['chat', 'code'] },
  { id: 'memory-on', name: 'memory-on', description: 'Enable memories for this session', kind: 'builtin', availableIn: ['chat', 'code'], requiresSession: true },
  { id: 'memory-off', name: 'memory-off', description: 'Disable memories for this session', kind: 'builtin', availableIn: ['chat', 'code'], requiresSession: true },
  { id: 'memory-incognito', name: 'memory-incognito', description: 'Incognito: no memory inject/extract this session', kind: 'builtin', availableIn: ['chat', 'code'], requiresSession: true },
  { id: 'memory-status', name: 'memory-status', description: 'Show memory flags for this session', kind: 'builtin', availableIn: ['chat', 'code'], requiresSession: true },
]

/** Pure: extract the slash command text the user is typing. Returns the raw text after `/`. */
export function extractSlashQuery(value: string): string | null {
  // Match `/` at start or after whitespace. The token must not contain `/` so
  // path-like fragments (`/tmp/file`, `check /tmp/file`) do not open the palette
  // and intercept Enter (which would block sending legitimate path text).
  const m = value.match(/(?:^|\s)\/([^\s/]*)$/)
  if (!m) return null
  return m[1]
}

/** Pure: filter commands matching a query. Sorts: name prefix match first, then includes, then description. */
export function filterCommands(
  commands: SlashCommand[],
  query: string,
): SlashCommand[] {
  const q = query.toLowerCase().trim()
  if (!q) return commands

  const scored = commands.map((cmd) => {
    const name = cmd.name.toLowerCase()
    const desc = (cmd.description || '').toLowerCase()
    let score = 3
    if (name.startsWith(q)) score = 0
    else if (name.includes(q)) score = 1
    else if (desc.includes(q)) score = 2
    else score = 3
    return { cmd, score }
  })

  return scored
    .filter((s) => s.score < 3)
    .sort((a, b) => a.score - b.score || a.cmd.name.localeCompare(b.cmd.name))
    .map((s) => s.cmd)
}

/** Pure: build the full command list from skills, etc. */
export function buildCommandList(
  skills?: SkillMeta[],
  opts?: { surface?: ComposerSurface; sessionId?: string | null },
): SlashCommand[] {
  const surface = opts?.surface ?? 'chat'
  const sessionId = opts?.sessionId ?? null
  const out = BUILTIN_COMMANDS.filter((cmd) => {
    if (cmd.availableIn && !cmd.availableIn.includes(surface)) return false
    if (cmd.requiresSession && sessionId == null) return false
    return true
  })
  if (skills) {
    for (const s of skills) {
      out.push({
        id: s.id,
        name: s.name,
        description: s.description || s.name,
        kind: 'skill',
        availableIn: ['chat', 'code'],
      })
    }
  }
  return out
}

/** Pure: format the replacement text when a command is selected. */
export function applyCommand(command: SlashCommand, currentValue: string): string {
  const m = currentValue.match(/^((?:.*\s)?)\/[^\s/]*$/)
  const prefix = m ? m[1] : ''
  return `${prefix}/${command.name} `
}

interface SlashCommandPaletteProps {
  value: string
  surface: ComposerSurface
  sessionId?: string | null
  skills?: SkillMeta[]
  onSelect: (command: SlashCommand) => void
  onDismiss?: () => void
}

/**
 * Slash command palette — triggered when the user types `/` in the chat composer.
 * Shows built-in commands, skill names, and (future) MCP prompts.
 * Filterable as the user types; Enter/click selects a command.
 */
export function SlashCommandPalette({ value, surface, sessionId, skills, onSelect, onDismiss }: SlashCommandPaletteProps) {
  const { t } = useTranslation()
  const query = useMemo(() => extractSlashQuery(value), [value])
  const commands = useMemo(() => buildCommandList(skills, { surface, sessionId }), [skills, surface, sessionId])
  const filtered = useMemo(
    () => (query !== null ? filterCommands(commands, query) : []),
    [commands, query],
  )

  const [activeIndex, setActiveIndex] = useState(0)
  const activeRef = useRef<HTMLButtonElement | null>(null)

  // User changed the query: reset highlight to first match.
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // List shrank (skills load, surface switch, etc.): clamp so Enter never no-ops on OOB.
  useEffect(() => {
    setActiveIndex((i) =>
      filtered.length === 0 ? 0 : Math.min(i, filtered.length - 1),
    )
  }, [filtered])

  const safeIndex =
    filtered.length === 0 ? 0 : Math.min(activeIndex, filtered.length - 1)

  useEffect(() => {
    if (filtered.length === 0) return
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [safeIndex, filtered])

  // Always attach while mounted so empty-state Enter cannot fall through to Composer submit.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (filtered.length === 0) return
        setActiveIndex((i) => {
          const cur = Math.min(i, filtered.length - 1)
          return Math.min(cur + 1, filtered.length - 1)
        })
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (filtered.length === 0 || safeIndex <= 0) {
          onDismiss?.()
        } else {
          setActiveIndex(safeIndex - 1)
        }
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (filtered[safeIndex]) onSelect(filtered[safeIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onDismiss?.()
        return
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [safeIndex, filtered, onSelect, onDismiss])

  if (query === null) return null

  return (
    <div
      role="listbox"
      aria-label={t('chat.slash.listLabel')}
      data-testid="slash-palette"
      className="absolute bottom-full left-0 right-0 mb-2 rounded-lg border border-border bg-surface shadow-overlay max-h-48 overflow-y-auto z-50"
    >
      {filtered.length === 0 ? (
        <div
          data-testid="slash-palette-empty"
          className="px-3 py-4 text-center text-meta text-ink-secondary"
          role="presentation"
        >
          {t('chat.slash.noMatch')}
        </div>
      ) : (
        filtered.map((cmd, i) => (
          <button
            key={`${cmd.kind}:${cmd.id}`}
            id={`slash-opt-${cmd.kind}-${cmd.id}`}
            type="button"
            data-testid={`slash-cmd-${cmd.name}`}
            role="option"
            aria-selected={i === safeIndex}
            ref={i === safeIndex ? activeRef : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(cmd)}
            onMouseEnter={() => setActiveIndex(i)}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2 text-left text-body text-ink transition-colors hover:bg-accent-subtle first:rounded-t-lg last:rounded-b-lg',
              i === safeIndex && 'bg-accent-subtle',
            )}
          >
            <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-caption font-mono text-accent">
              /{cmd.name}
            </span>
            <span className="flex-1 truncate text-ink-secondary">{cmd.description}</span>
            <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-caption text-ink-tertiary">
              {cmd.kind}
            </span>
          </button>
        ))
      )}
    </div>
  )
}
