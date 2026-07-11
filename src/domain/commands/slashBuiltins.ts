/**
 * Shared catalog of built-in slash commands.
 * Composer slash palette and docs should import from here (single source of truth).
 * Global ⌘K context actions call the same domain handlers but use palette-specific labels/ids.
 *
 * Display copy lives in i18n (`chat.slash.cmd.<id>`). `description` is the English
 * fallback for pure/unit contexts that do not pass a translator.
 */

export type ComposerSurface = 'chat' | 'code'

export interface SlashBuiltinDef {
  id: string
  name: string
  /** English fallback; UI should prefer `slashCmdDescriptionKey(id)` via i18n. */
  description: string
  kind: 'builtin'
  availableIn: ComposerSurface[]
  requiresSession?: boolean
}

/** i18n key for a built-in slash command description (`chat.slash.cmd.<id>`). */
export function slashCmdDescriptionKey(id: string): string {
  return `chat.slash.cmd.${id}`
}

/** Built-in slash commands (not skills). */
export const SLASH_BUILTIN_COMMANDS: SlashBuiltinDef[] = [
  {
    id: 'help',
    name: 'help',
    description: 'Show available commands',
    kind: 'builtin',
    availableIn: ['chat', 'code'],
  },
  {
    id: 'clear',
    name: 'clear',
    description: 'Start a new conversation',
    kind: 'builtin',
    availableIn: ['chat', 'code'],
  },
  {
    id: 'diff',
    name: 'diff',
    description: 'Show workspace changes',
    kind: 'builtin',
    availableIn: ['code'],
  },
  {
    id: 'compact',
    name: 'compact',
    description: 'Summarize conversation to save context (optional: /compact focus…)',
    kind: 'builtin',
    availableIn: ['chat', 'code'],
    requiresSession: true,
  },
  {
    id: 'init',
    name: 'init',
    description: 'Create or update AGENTS.md with project guidance',
    kind: 'builtin',
    availableIn: ['code'],
    requiresSession: true,
  },
  {
    id: 'memory',
    name: 'memory',
    description: 'Open Memory settings',
    kind: 'builtin',
    availableIn: ['chat', 'code'],
  },
  {
    id: 'memory-on',
    name: 'memory-on',
    description: 'Enable memory injection for this session',
    kind: 'builtin',
    availableIn: ['chat', 'code'],
    requiresSession: true,
  },
  {
    id: 'memory-off',
    name: 'memory-off',
    description: 'Disable memory injection for this session',
    kind: 'builtin',
    availableIn: ['chat', 'code'],
    requiresSession: true,
  },
  {
    id: 'memory-incognito',
    name: 'memory-incognito',
    description: 'Incognito: no memory inject/extract this session',
    kind: 'builtin',
    availableIn: ['chat', 'code'],
    requiresSession: true,
  },
  {
    id: 'memory-incognito-off',
    name: 'memory-incognito-off',
    description: 'Exit incognito memory for this session',
    kind: 'builtin',
    availableIn: ['chat', 'code'],
    requiresSession: true,
  },
  {
    id: 'memory-status',
    name: 'memory-status',
    description: 'Show memory flags for this session',
    kind: 'builtin',
    availableIn: ['chat', 'code'],
    requiresSession: true,
  },
]
