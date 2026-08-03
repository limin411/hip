import { useMemo, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { SkillMeta } from '@hip/protocol'
import {
  SLASH_BUILTIN_COMMANDS,
  slashCmdDescriptionKey,
  type ComposerSurface,
} from '@/domain/commands/slashBuiltins'

export type { ComposerSurface }

/** One command shown in the palette. */
export interface SlashCommand {
  id: string
  name: string
  description: string
  kind: 'builtin' | 'skill' | 'mcp-prompt'
  availableIn: ComposerSurface[]
  requiresSession?: boolean
  onSelect?: () => void
}

/** Built-in slash commands — single source: `domain/commands/slashBuiltins`. */
export const BUILTIN_COMMANDS: SlashCommand[] = SLASH_BUILTIN_COMMANDS.map((c) => ({
  ...c,
}))

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

/** Missing map entry → enabled (align with command-palette registry). */
export function isSkillListed(id: string, enabled?: Record<string, boolean>): boolean {
  if (!enabled) return true
  return enabled[id] !== false
}

/** Pure: build the full command list from skills, etc. */
export function buildCommandList(
  skills?: SkillMeta[],
  opts?: {
    surface?: ComposerSurface
    sessionId?: string | null
    /** Skill id → enabled; missing key means enabled. */
    skillsEnabled?: Record<string, boolean>
    /**
     * Localize a built-in command description.
     * Receives i18n key + English fallback; omit in pure tests to keep catalog copy.
     */
    translateBuiltin?: (key: string, fallback: string) => string
  },
): SlashCommand[] {
  const surface = opts?.surface ?? 'chat'
  const sessionId = opts?.sessionId ?? null
  const translate = opts?.translateBuiltin
  const out = BUILTIN_COMMANDS.filter((cmd) => {
    if (cmd.availableIn && !cmd.availableIn.includes(surface)) return false
    if (cmd.requiresSession && sessionId == null) return false
    return true
  }).map((cmd) =>
    translate
      ? {
          ...cmd,
          description: translate(slashCmdDescriptionKey(cmd.id), cmd.description),
        }
      : cmd,
  )
  if (skills) {
    for (const s of skills) {
      if (!isSkillListed(s.id, opts?.skillsEnabled)) continue
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
  skillsEnabled?: Record<string, boolean>
  onSelect: (command: SlashCommand) => void
  onDismiss?: () => void
  /**
   * Tab completion: fills the highlighted command into the composer WITHOUT
   * running it. Omit to let Tab keep its default focus behavior.
   */
  onComplete?: (command: SlashCommand) => void
  /**
   * When true, Enter with NO matching command is NOT swallowed: the palette
   * dismisses and the event falls through to the composer, so unknown slash
   * text (e.g. a `/compcat` typo) is sent as a normal message instead of
   * silently doing nothing. Chat keeps the default blocking behavior.
   */
  enterFallsThroughOnEmpty?: boolean
}

/**
 * Slash command palette — triggered when the user types `/` in the chat composer.
 * Shows built-in commands, skill names, and (future) MCP prompts.
 * Filterable as the user types; Enter/click selects a command.
 */
export function SlashCommandPalette({
  value,
  surface,
  sessionId,
  skills,
  skillsEnabled,
  onSelect,
  onDismiss,
  onComplete,
  enterFallsThroughOnEmpty = false,
}: SlashCommandPaletteProps) {
  const { t } = useTranslation()
  const query = useMemo(() => extractSlashQuery(value), [value])
  const commands = useMemo(
    () =>
      buildCommandList(skills, {
        surface,
        sessionId,
        skillsEnabled,
        translateBuiltin: (key, fallback) => t(key, { defaultValue: fallback }),
      }),
    [skills, skillsEnabled, surface, sessionId, t],
  )
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
      // IME: do not steal composition commit keys (pinyin Enter etc.).
      if (e.isComposing || e.key === 'Process') return
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
        if (filtered.length === 0 && enterFallsThroughOnEmpty) {
          // No match: let the composer handle Enter (send as plain text).
          onDismiss?.()
          return
        }
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
      if (e.key === 'Tab' && !e.shiftKey) {
        // Complete the highlighted command into the composer without executing
        // it. No match (or no handler) → let the browser move focus normally.
        if (filtered.length === 0 || !onComplete) return
        e.preventDefault()
        e.stopImmediatePropagation()
        onComplete(filtered[safeIndex])
        return
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [safeIndex, filtered, onSelect, onDismiss, onComplete, enterFallsThroughOnEmpty])

  if (query === null) return null

  return (
    <div
      role="listbox"
      aria-label={t('chat.slash.listLabel')}
      data-testid="slash-palette"
      className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-48 animate-menu-in overflow-y-auto rounded-xl border border-border bg-surface shadow-overlay"
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
              'flex w-full items-center gap-2 px-3 py-2 text-left text-body text-ink transition-colors hover:bg-state-hover first:rounded-t-lg last:rounded-b-lg',
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
