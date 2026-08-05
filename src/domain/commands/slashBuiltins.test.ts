import { describe, expect, it } from 'vitest'
import {
  SLASH_BUILTIN_COMMANDS,
  slashCmdDescriptionKey,
  type ComposerSurface,
} from './slashBuiltins'

const SURFACES: ComposerSurface[] = ['chat', 'code', 'terminal']

describe('SLASH_BUILTIN_COMMANDS', () => {
  it('has unique ids and names', () => {
    const ids = SLASH_BUILTIN_COMMANDS.map((c) => c.id)
    const names = SLASH_BUILTIN_COMMANDS.map((c) => c.name)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps availableIn within known surfaces', () => {
    for (const cmd of SLASH_BUILTIN_COMMANDS) {
      expect(cmd.availableIn.length).toBeGreaterThan(0)
      for (const s of cmd.availableIn) {
        expect(SURFACES).toContain(s)
      }
    }
  })

  it('exposes compact on chat, code, and terminal with requiresSession', () => {
    const compact = SLASH_BUILTIN_COMMANDS.find((c) => c.id === 'compact')
    expect(compact).toBeDefined()
    expect(compact!.availableIn).toEqual(['chat', 'code', 'terminal'])
    expect(compact!.requiresSession).toBe(true)
  })

  it('only compact is available on the terminal surface', () => {
    const terminalCmds = SLASH_BUILTIN_COMMANDS.filter((c) =>
      c.availableIn.includes('terminal'),
    )
    expect(terminalCmds.map((c) => c.id)).toEqual(['compact'])
  })

  it('slashCmdDescriptionKey nests under chat.slash.cmd', () => {
    expect(slashCmdDescriptionKey('compact')).toBe('chat.slash.cmd.compact')
    expect(slashCmdDescriptionKey('help')).toBe('chat.slash.cmd.help')
  })
})
