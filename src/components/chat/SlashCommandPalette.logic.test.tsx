// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { SkillMeta } from '@hip/protocol'
import '@/i18n'
import {
  extractSlashQuery,
  filterCommands,
  buildCommandList,
  applyCommand,
  BUILTIN_COMMANDS,
  SlashCommandPalette,
  type SlashCommand,
} from './SlashCommandPalette'

const fixturePluginDir = path.resolve(import.meta.dirname, '../../../e2e/fixtures/sample-plugin')

function readFixtureSkillMeta(skillName: string): SkillMeta {
  const dir = path.join(fixturePluginDir, 'skills', skillName)
  const raw = readFileSync(path.join(dir, 'SKILL.md'), 'utf8')
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const frontmatter = frontmatterMatch ? frontmatterMatch[1] : ''
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1].trim() ?? skillName
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1].trim() ?? skillName

  const args: Array<{ name: string; description: string; required?: boolean }> = []
  const argRe = /^\s+- name:\s*(.+)\n\s+description:\s*(.+)$/gm
  let match: RegExpExecArray | null
  while ((match = argRe.exec(frontmatter)) !== null) {
    args.push({ name: match[1].trim(), description: match[2].trim() })
  }

  return {
    id: skillName,
    name,
    description,
    dir,
    hasScripts: false,
    hasReferences: skillName === 'sample-format',
    scope: 'plugin',
    pluginId: 'sample-plugin',
    userInvocable: true,
    arguments: args.length > 0 ? args : undefined,
  }
}

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

  it('does not treat path-like tokens with multiple slashes as slash queries', () => {
    expect(extractSlashQuery('/tmp/file')).toBeNull()
    expect(extractSlashQuery('check /tmp/file')).toBeNull()
    expect(extractSlashQuery('see /a/b/c')).toBeNull()
  })

  it('still matches a single path segment after slash (ambiguous with command names)', () => {
    expect(extractSlashQuery('/tmp')).toBe('tmp')
    expect(extractSlashQuery('check /tmp')).toBe('tmp')
  })
})

describe('filterCommands', () => {
  const cmds: SlashCommand[] = [
    { id: 'help', name: 'help', description: 'Show available commands', kind: 'builtin', availableIn: ['chat', 'code'] },
    { id: 'clear', name: 'clear', description: 'Start a new conversation', kind: 'builtin', availableIn: ['chat', 'code'] },
    { id: 'diff', name: 'diff', description: 'Show workspace changes', kind: 'builtin', availableIn: ['code'] },
    { id: 'init', name: 'init', description: 'Initialize a new project', kind: 'builtin', availableIn: ['code'] },
    { id: 'fmt', name: 'fmt', description: 'Format code', kind: 'skill', availableIn: ['chat', 'code'] },
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

  it('defaults to chat surface and excludes code-only builtins', () => {
    const list = buildCommandList()
    expect(list.map((c) => c.name)).toEqual(['help', 'clear', 'memory'])
    expect(list.map((c) => c.name)).not.toContain('diff')
    expect(list.map((c) => c.name)).not.toContain('init')
    expect(list.map((c) => c.name)).not.toContain('compact')
    expect(list.map((c) => c.name)).not.toContain('config')
    // session-gated memory commands require a sessionId
    expect(list.map((c) => c.name)).not.toContain('memory-on')
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

describe('SlashCommand interface', () => {
  it('accepts onSelect field when provided', () => {
    const cmd: SlashCommand = {
      id: 'test',
      name: 'test',
      description: 'A test command',
      kind: 'builtin',
      availableIn: ['chat', 'code'],
      onSelect: () => {},
    }
    expect(cmd.onSelect).toBeDefined()
    // Verify the function is callable
    expect(() => cmd.onSelect!()).not.toThrow()
  })

  it('remains valid without onSelect field for backward compat', () => {
    const cmd: SlashCommand = {
      id: 'test',
      name: 'test',
      description: 'A test command',
      kind: 'builtin',
      availableIn: ['chat', 'code'],
    }
    expect(cmd.id).toBe('test')
    expect(cmd.onSelect).toBeUndefined()
  })

  it('objects with onSelect pass through filterCommands unchanged', () => {
    const cmds: SlashCommand[] = [
      { id: 'a', name: 'alpha', description: 'Alpha cmd', kind: 'builtin', availableIn: ['chat', 'code'], onSelect: () => {} },
      { id: 'b', name: 'beta', description: 'Beta cmd', kind: 'builtin', availableIn: ['chat', 'code'] },
    ]
    const result = filterCommands(cmds, '')
    expect(result).toHaveLength(2)
    expect(result[0].onSelect).toBeDefined()
    expect(result[1].onSelect).toBeUndefined()
  })
})

describe('SlashCommandPalette keyboard navigation', () => {
  beforeEach(() => {
    cleanup()
  })

  it('highlights the first item by default with aria-selected', () => {
    render(
      <SlashCommandPalette
        value="/"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(BUILTIN_COMMANDS.length)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    // All others are not selected
    for (let i = 1; i < options.length; i++) {
      expect(options[i]).toHaveAttribute('aria-selected', 'false')
    }
  })

  it('ArrowDown advances activeIndex to the next item', () => {
    render(
      <SlashCommandPalette
        value="/"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    const options = screen.getAllByRole('option')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
  })

  it('ArrowDown stops at the last item', () => {
    render(
      <SlashCommandPalette
        value="/"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    const lastIndex = BUILTIN_COMMANDS.length - 1
    // Press ArrowDown many times — should cap at lastIndex
    for (let i = 0; i < lastIndex + 5; i++) {
      fireEvent.keyDown(document, { key: 'ArrowDown' })
    }
    const options = screen.getAllByRole('option')
    expect(options[lastIndex]).toHaveAttribute('aria-selected', 'true')
  })

  it('ArrowUp moves activeIndex up', () => {
    render(
      <SlashCommandPalette
        value="/"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    // Move down twice
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    // Move up once
    fireEvent.keyDown(document, { key: 'ArrowUp' })
    const options = screen.getAllByRole('option')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('ArrowUp at first item calls onDismiss', () => {
    const onDismiss = vi.fn()
    render(
      <SlashCommandPalette
        value="/"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={onDismiss}
      />,
    )
    fireEvent.keyDown(document, { key: 'ArrowUp' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('Escape calls onDismiss', () => {
    const onDismiss = vi.fn()
    render(
      <SlashCommandPalette
        value="/"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={onDismiss}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('Enter on active item calls onSelect with the correct command', () => {
    const onSelect = vi.fn()
    render(
      <SlashCommandPalette
        value="/"
        surface="code"
        sessionId="s1"
        onSelect={onSelect}
        onDismiss={vi.fn()}
      />,
    )
    // By default, first item is active
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: BUILTIN_COMMANDS[0].id }),
    )
  })

  it('Enter on second item after ArrowDown selects that item', () => {
    const onSelect = vi.fn()
    render(
      <SlashCommandPalette
        value="/"
        surface="code"
        sessionId="s1"
        onSelect={onSelect}
        onDismiss={vi.fn()}
      />,
    )
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: BUILTIN_COMMANDS[1].id }),
    )
  })

  it('onMouseEnter sets activeIndex to the hovered item', () => {
    render(
      <SlashCommandPalette
        value="/"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    const options = screen.getAllByRole('option')
    fireEvent.mouseEnter(options[2])
    expect(options[2]).toHaveAttribute('aria-selected', 'true')
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
  })

  it('does not intercept Enter with Shift key held', () => {
    const onSelect = vi.fn()
    render(
      <SlashCommandPalette
        value="/"
        surface="code"
        sessionId="s1"
        onSelect={onSelect}
        onDismiss={vi.fn()}
      />,
    )
    fireEvent.keyDown(document, { key: 'Enter', shiftKey: true })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('returns null when no slash query is present', () => {
    const { container } = render(
      <SlashCommandPalette
        value="hello"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows empty state when query matches nothing', () => {
    render(
      <SlashCommandPalette
        value="/zzz"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByTestId('slash-palette')).toBeInTheDocument()
    expect(screen.getByTestId('slash-palette-empty')).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('Escape on empty state calls onDismiss', () => {
    const onDismiss = vi.fn()
    render(
      <SlashCommandPalette
        value="/zzz"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={onDismiss}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('ArrowUp on empty state calls onDismiss', () => {
    const onDismiss = vi.fn()
    render(
      <SlashCommandPalette
        value="/zzz"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={onDismiss}
      />,
    )
    fireEvent.keyDown(document, { key: 'ArrowUp' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('Enter on empty state does not call onSelect', () => {
    const onSelect = vi.fn()
    render(
      <SlashCommandPalette
        value="/zzz"
        surface="code"
        sessionId="s1"
        onSelect={onSelect}
        onDismiss={vi.fn()}
      />,
    )
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('ArrowDown on empty state is a no-op', () => {
    const onDismiss = vi.fn()
    render(
      <SlashCommandPalette
        value="/zzz"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={onDismiss}
      />,
    )
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(onDismiss).not.toHaveBeenCalled()
    expect(screen.getByTestId('slash-palette-empty')).toBeInTheDocument()
  })

  it('clamps highlight when filtered list shrinks via query', () => {
    const { rerender } = render(
      <SlashCommandPalette
        value="/"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    // Move to last item
    for (let i = 0; i < BUILTIN_COMMANDS.length; i++) {
      fireEvent.keyDown(document, { key: 'ArrowDown' })
    }
    // Narrow to a single match so previous index would be OOB without clamp
    rerender(
      <SlashCommandPalette
        value="/help"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[0]).toHaveAttribute('id', 'slash-opt-builtin-help')
  })

  it('uses kind:id for React option identity and stable DOM ids', () => {
    const skills: SkillMeta[] = [
      {
        id: 'help',
        name: 'help-skill',
        description: 'Skill help',
        scope: 'global',
        dir: '/tmp/help',
        hasScripts: false,
      },
    ]
    render(
      <SlashCommandPalette
        value="/"
        surface="chat"
        sessionId="s1"
        skills={skills}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(document.getElementById('slash-opt-builtin-help')).toBeTruthy()
    expect(document.getElementById('slash-opt-skill-help')).toBeTruthy()
  })

  it('prevents mousedown default on options to keep composer focus', () => {
    render(
      <SlashCommandPalette
        value="/"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    const option = screen.getAllByRole('option')[0]
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    option.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('scrolls the active option into view on keyboard navigation', () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    render(
      <SlashCommandPalette
        value="/"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    scrollSpy.mockClear()
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' })
    scrollSpy.mockRestore()
  })

  it('exposes listbox aria-label for chrome a11y', () => {
    render(
      <SlashCommandPalette
        value="/"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-label', 'Commands')
  })
})

describe('buildCommandList surface filtering', () => {
  it('includes universal builtins and compact in chat surface with a session', () => {
    const list = buildCommandList([], { surface: 'chat', sessionId: 's1' })
    expect(list.map((c) => c.name)).toEqual([
      'help',
      'clear',
      'compact',
      'memory',
      'memory-on',
      'memory-off',
      'memory-incognito',
      'memory-status',
    ])
  })

  it('includes all builtins in code surface with a session', () => {
    const list = buildCommandList([], { surface: 'code', sessionId: 's1' })
    expect(list.map((c) => c.name)).toContain('diff')
    expect(list.map((c) => c.name)).toContain('init')
    expect(list.map((c) => c.name)).toContain('compact')
  })

  it('excludes compact in code surface when sessionId is null', () => {
    const list = buildCommandList([], { surface: 'code', sessionId: null })
    expect(list.map((c) => c.name)).toContain('diff')
    expect(list.map((c) => c.name)).toContain('init')
    expect(list.map((c) => c.name)).not.toContain('compact')
  })
})

describe('SlashCommandPalette surface rendering', () => {
  beforeEach(() => {
    cleanup()
  })

  it('hides code-only commands in chat surface but shows compact', () => {
    render(
      <SlashCommandPalette
        value="/"
        surface="chat"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('slash-cmd-diff')).not.toBeInTheDocument()
    expect(screen.queryByTestId('slash-cmd-init')).not.toBeInTheDocument()
    expect(screen.queryByTestId('slash-cmd-help')).toBeInTheDocument()
    expect(screen.queryByTestId('slash-cmd-compact')).toBeInTheDocument()
  })

  it('shows code-only commands in code surface', () => {
    render(
      <SlashCommandPalette
        value="/"
        surface="code"
        sessionId="s1"
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('slash-cmd-diff')).toBeInTheDocument()
    expect(screen.queryByTestId('slash-cmd-init')).toBeInTheDocument()
  })

  it('hides compact in code surface when sessionId is null', () => {
    render(
      <SlashCommandPalette
        value="/"
        surface="code"
        sessionId={null}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('slash-cmd-diff')).toBeInTheDocument()
    expect(screen.queryByTestId('slash-cmd-compact')).not.toBeInTheDocument()
  })
})

describe('fixture plugin skills in slash palette', () => {
  beforeEach(() => {
    cleanup()
  })

  it('plugin-contributed skills render with kind: skill badge', () => {
    const skills = [readFixtureSkillMeta('sample-greet')]
    render(
      <SlashCommandPalette
        value="/"
        surface="chat"
        sessionId="s1"
        skills={skills}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    const option = screen.getByTestId('slash-cmd-sample-greet')
    expect(option).toBeInTheDocument()
    expect(option.textContent).toContain('skill')
  })

  it('plugin skills appear in both chat and code surfaces', () => {
    const skills = [readFixtureSkillMeta('sample-greet'), readFixtureSkillMeta('sample-format')]
    const { rerender } = render(
      <SlashCommandPalette
        value="/"
        surface="chat"
        sessionId="s1"
        skills={skills}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByTestId('slash-cmd-sample-greet')).toBeInTheDocument()
    expect(screen.getByTestId('slash-cmd-sample-format')).toBeInTheDocument()

    rerender(
      <SlashCommandPalette
        value="/"
        surface="code"
        sessionId="s1"
        skills={skills}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByTestId('slash-cmd-sample-greet')).toBeInTheDocument()
    expect(screen.getByTestId('slash-cmd-sample-format')).toBeInTheDocument()
  })

  it('excludes skills with userInvocable: false when the consumer filters before passing to the palette', () => {
    const allSkills = [
      readFixtureSkillMeta('sample-greet'),
      { ...readFixtureSkillMeta('sample-format'), userInvocable: false },
    ]
    const visibleSkills = allSkills.filter((sk) => sk.userInvocable !== false)
    render(
      <SlashCommandPalette
        value="/"
        surface="chat"
        sessionId="s1"
        skills={visibleSkills}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByTestId('slash-cmd-sample-greet')).toBeInTheDocument()
    expect(screen.queryByTestId('slash-cmd-sample-format')).not.toBeInTheDocument()
  })
})
