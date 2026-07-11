/**
 * Shared catalog of built-in slash commands.
 * Composer slash palette and docs should import from here (single source of truth).
 * Global ⌘K context actions call the same domain handlers but use palette-specific labels/ids.
 */

export type ComposerSurface = 'chat' | 'code'

export interface SlashBuiltinDef {
  id: string
  name: string
  description: string
  kind: 'builtin'
  availableIn: ComposerSurface[]
  requiresSession?: boolean
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
    description: 'Initialize a new project',
    kind: 'builtin',
    availableIn: ['code'],
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
    description: 'Enable memories for this session',
    kind: 'builtin',
    availableIn: ['chat', 'code'],
    requiresSession: true,
  },
  {
    id: 'memory-off',
    name: 'memory-off',
    description: 'Disable memories for this session',
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
    id: 'memory-status',
    name: 'memory-status',
    description: 'Show memory flags for this session',
    kind: 'builtin',
    availableIn: ['chat', 'code'],
    requiresSession: true,
  },
]
