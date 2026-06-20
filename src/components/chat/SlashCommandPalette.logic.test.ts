import { describe, it, expect } from 'vitest'
import {
  extractSlashQuery,
  filterCommands,
  buildCommandList,
  applyCommand,
  BUILTIN_COMMANDS,
  type SlashCommand,
} from './SlashCommandPalette'

describe('extractSlashQuery', () => {
  it('returns null when there is no slash', () => {
    expect(extractSlashQuery('Hello')).toBeNull()
    expect(extractSlashQuery('')).toBeNull()
    expect(extractSlashQuery('normal text')).toBeNull()
  })

  it('detects / at start of input', () => {
    expect(extractSlashQuery('/hel')).toBe('hel')
    expect(extractSlashQuery('/')).toBe('')
  })

  it('detects / after whitespace', () => {
    expect(extractSlashQuery('text /hel')).toBe('hel')
  })

  it('returns null when slash is in the middle of a word', () => {
    expect(extractSlashQuery('path/to/file')).toBeNull()
  })

  it('returns null for slash as the last character before new word', () => {
    expect(extractSlashQuery('cmd/ ')).toBeNull()
  })

  it('does not match slash in the middle of text without whitespace before it', () => {
    expect(extractSlashQuery('a/command')).toBeNull()
  })

  it('handles multiple words with slash at end', () => {
    expect(extractSlashQuery('hello world /my')).toBe('my')
  })
})

describe('filterCommands', () => {
  const cmds: SlashCommand[] = [
    { id: 'help', name: 'help', description: 'Show available commands', kind: 'builtin' },
    { id: 'clear', name: 'clear', description: 'Start a new conversation', kind: 'builtin' },
    { id: 'diff', name: 'diff', description: 'Show workspace changes', kind: 'builtin' },
    { id: 'init', name: 'init', description: 'Initialize a new project', kind: 'builtin' },
    { id: 'fmt', name: 'fmt', description: 'Format code', kind: 'skill' },
  ]

  it('returns all commands when query is empty', () => {
    expect(filterCommands(cmds, '')).toEqual(cmds)
  })

  it('filters by name prefix match', () => {
    const result = filterCommands(cmds, 'he')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('help')
  })

  it('filters by name substring match', () => {
    const result = filterCommands(cmds, 'iff')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('diff')
  })

  it('filters by description match', () => {
    const result = filterCommands(cmds, 'workspace')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('diff')
  })

  it('sorts prefix matches before substring matches', () => {
    const result = filterCommands(cmds, 'i')
    expect(result[0].name).toBe('init')
    expect(result.map((c) => c.name)).toContain('diff')
  })

  it('returns empty for no matches', () => {
    expect(filterCommands(cmds, 'zzz')).toEqual([])
  })

  it('is case-insensitive', () => {
    const result = filterCommands(cmds, 'HEL')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('help')
  })
})

describe('buildCommandList', () => {
  it('includes built-in commands', () => {
    const list = buildCommandList()
    expect(list.map((c) => c.name)).toContain('help')
    expect(list.map((c) => c.name)).toContain('clear')
  })

  it('includes skills when provided', () => {
    const list = buildCommandList([
      { id: 's1', name: 'my-skill', description: 'My Skill', scope: 'global', autoInvoke: false, dir: '/tmp/s1', hasScripts: false },
      { id: 's2', name: 'fmt', description: 'Format code', scope: 'project', autoInvoke: true, dir: '/tmp/s2', hasScripts: false },
    ])
    const skillCommands = list.filter((c) => c.kind === 'skill')
    expect(skillCommands).toHaveLength(2)
    expect(skillCommands[0].name).toBe('my-skill')
  })

  it('ranks builtins before skills', () => {
    const list = buildCommandList([
      { id: 's1', name: 'help', description: 'Skill help', scope: 'global', autoInvoke: false, dir: '/tmp/s1', hasScripts: false },
    ])
    const helpCmds = list.filter((c) => c.name === 'help')
    expect(helpCmds).toHaveLength(2)
    expect(helpCmds[0].kind).toBe('builtin')
    expect(helpCmds[1].kind).toBe('skill')
  })
})

describe('applyCommand', () => {
  it('replaces the slash query with the command name', () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === 'help')!
    expect(applyCommand(cmd, '/hel')).toBe('/help ')
  })

  it('preserves text before the slash', () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === 'diff')!
    expect(applyCommand(cmd, 'tell me /di')).toBe('tell me /diff ')
  })

  it('handles empty query after slash', () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === 'clear')!
    expect(applyCommand(cmd, '/')).toBe('/clear ')
  })

  it('preserves text before the last slash', () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === 'help')!
    expect(applyCommand(cmd, 'hello /hel')).toBe('hello /help ')
  })
})
