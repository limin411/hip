import { useMemo, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import type { SkillMeta } from '@hip/protocol'

/** One command shown in the palette. */
export interface SlashCommand {
  id: string
  name: string
  description: string
  kind: 'builtin' | 'skill' | 'mcp-prompt'
  onSelect?: () => void
}

/** Built-in slash commands. */
export const BUILTIN_COMMANDS: SlashCommand[] = [
  { id: 'help', name: 'help', description: 'Show available commands', kind: 'builtin' },
  { id: 'clear', name: 'clear', description: 'Start a new conversation', kind: 'builtin' },
  { id: 'config', name: 'config', description: 'Show or edit configuration', kind: 'builtin' },
  { id: 'diff', name: 'diff', description: 'Show workspace changes', kind: 'builtin' },
  { id: 'compact', name: 'compact', description: 'Summarize conversation to save context', kind: 'builtin' },
  { id: 'init', name: 'init', description: 'Initialize a new project', kind: 'builtin' },
]

/** Pure: extract the slash command text the user is typing. Returns the raw text after `/`. */
export function extractSlashQuery(value: string): string | null {
  // Match `/` at start, optionally after leading whitespace
  const m = value.match(/(?:^|\s)\/(\S*)$/)
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
export function buildCommandList(skills?: SkillMeta[]): SlashCommand[] {
  const out = [...BUILTIN_COMMANDS]
  if (skills) {
    for (const s of skills) {
      out.push({
        id: s.id,
        name: s.name,
        description: s.description || s.name,
        kind: 'skill',
      })
    }
  }
  return out
}

/** Pure: format the replacement text when a command is selected. */
export function applyCommand(command: SlashCommand, currentValue: string): string {
  const m = currentValue.match(/^((?:.*\s)?)\/\S*$/)
  const prefix = m ? m[1] : ''
  return `${prefix}/${command.name} `
}

interface SlashCommandPaletteProps {
  value: string
  skills?: SkillMeta[]
  onSelect: (command: SlashCommand) => void
  onDismiss?: () => void
}

/**
 * Slash command palette — triggered when the user types `/` in the chat composer.
 * Shows built-in commands, skill names, and (future) MCP prompts.
 * Filterable as the user types; Enter/click selects a command.
 */
export function SlashCommandPalette({ value, skills, onSelect, onDismiss }: SlashCommandPaletteProps) {
  const query = useMemo(() => extractSlashQuery(value), [value])
  const commands = useMemo(() => buildCommandList(skills), [skills])
  const filtered = useMemo(
    () => (query !== null ? filterCommands(commands, query) : []),
    [commands, query],
  )

  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => setActiveIndex(0), [query])

  useEffect(() => {
    if (filtered.length === 0) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (activeIndex <= 0) {
          onDismiss?.()
        } else {
          setActiveIndex((i) => i - 1)
        }
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (filtered[activeIndex]) onSelect(filtered[activeIndex])
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
  }, [activeIndex, filtered, onSelect, onDismiss])

  if (query === null || filtered.length === 0) return null

  return (
    <div
      role="listbox"
      className="absolute bottom-full left-0 right-0 mb-2 rounded-lg border border-border bg-surface shadow-overlay max-h-48 overflow-y-auto z-50"
    >
      {filtered.map((cmd, i) => (
        <button
          key={cmd.id}
          role="option"
          aria-selected={i === activeIndex}
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => setActiveIndex(i)}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-2 text-left text-body text-ink transition-colors hover:bg-accent-subtle first:rounded-t-lg last:rounded-b-lg',
            i === activeIndex && 'bg-accent-subtle',
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
      ))}
    </div>
  )
}
