import { describe, it, expect } from 'vitest'
import {
  toolTitleHint,
  shortenPath,
  humanizeToolError,
  toolCategory,
  parseToolInput,
} from './toolPresentation'

describe('toolPresentation', () => {
  it('toolTitleHint for grep includes pattern', () => {
    expect(
      toolTitleHint({ name: 'grep', input: JSON.stringify({ pattern: 'zuolin', caseInsensitive: true }) }),
    ).toContain('zuolin')
  })

  it('toolTitleHint for glob and ls', () => {
    expect(toolTitleHint({ name: 'glob', input: '{"pattern":"**/*Sync*"}' })).toContain('**/*Sync*')
    expect(toolTitleHint({ name: 'ls', input: '{"path":"permission/src"}' })).toContain('permission/src')
  })

  it('toolTitleHint for read_file uses basename', () => {
    expect(
      toolTitleHint({
        name: 'read_file',
        input: '{"path":"permission/src/main/java/DataSyncServiceImpl.java"}',
      }),
    ).toContain('DataSyncServiceImpl.java')
  })

  it('toolTitleHint for task uses description', () => {
    expect(
      toolTitleHint({
        name: 'task',
        input: JSON.stringify({ description: 'Find Zuolin sync data', mode: 'foreground' }),
      }),
    ).toContain('Find Zuolin sync data')
  })

  it('shortenPath ellipsizes long paths', () => {
    const long = 'D:/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/DataSyncServiceImpl.java'
    const s = shortenPath(long, 40)
    expect(s.length).toBeLessThanOrEqual(41)
    expect(s).toContain('…')
  })

  it('humanizeToolError maps ENOTDIR', () => {
    const h = humanizeToolError(
      "ENOTDIR: not a directory, scandir 'D:\\\\proj\\\\DataSyncServiceImpl.java'",
      '{"path":"DataSyncServiceImpl.java"}',
    )
    expect(h.key).toBe('chat.tool.error.enotdir')
    expect(h.message.toLowerCase()).toMatch(/directory|file/)
  })

  it('humanizeToolError maps ENOENT', () => {
    const h = humanizeToolError("ENOENT: no such file or directory, open '/tmp/x'")
    expect(h.key).toBe('chat.tool.error.enoent')
  })

  it('toolCategory maps known tools', () => {
    expect(toolCategory('grep')).toBe('search')
    expect(toolCategory('read_file')).toBe('read')
    expect(toolCategory('glob')).toBe('browse')
    expect(toolCategory('task')).toBe('delegate')
    expect(toolCategory('write_todos')).toBe('plan')
    expect(toolCategory('mystery')).toBe('other')
  })

  it('parseToolInput handles bad json', () => {
    expect(parseToolInput('not-json')).toEqual({})
  })
})
