import { describe, expect, it } from 'vitest'
import { isWriteLikeTool, pathFromToolInput, shouldAutoFollowWrite } from './writeFollow'

describe('writeFollow (P1)', () => {
  it('detects write-like tools', () => {
    expect(isWriteLikeTool('write_file')).toBe(true)
    expect(isWriteLikeTool('edit_file')).toBe(true)
    expect(isWriteLikeTool('apply_patch')).toBe(true)
    expect(isWriteLikeTool('read_file')).toBe(false)
  })

  it('parses path from write_file input', () => {
    expect(pathFromToolInput('write_file', JSON.stringify({ path: '/src/a.ts' }))).toBe('/src/a.ts')
    expect(pathFromToolInput('edit_file', JSON.stringify({ file_path: 'b.ts' }))).toBe('b.ts')
  })

  it('parses path from apply_patch body', () => {
    const patch = '*** Begin Patch\n*** Update File: packages/foo/bar.ts\n@@\n-a\n+b\n*** End Patch\n'
    expect(pathFromToolInput('apply_patch', patch)).toBe('packages/foo/bar.ts')
  })

  it('gates auto-follow on flags and status', () => {
    expect(
      shouldAutoFollowWrite({
        autoFollow: true,
        followPaused: false,
        isActiveSession: true,
        toolName: 'write_file',
        status: 'finished',
      }),
    ).toBe(true)
    expect(
      shouldAutoFollowWrite({
        autoFollow: true,
        followPaused: true,
        isActiveSession: true,
        toolName: 'write_file',
        status: 'finished',
      }),
    ).toBe(false)
    expect(
      shouldAutoFollowWrite({
        autoFollow: true,
        followPaused: false,
        isActiveSession: true,
        toolName: 'write_file',
        status: 'error',
      }),
    ).toBe(false)
  })
})
