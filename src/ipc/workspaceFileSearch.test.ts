import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

import { workspaceFileSearch } from './workspaceFileSearch'

describe('workspaceFileSearch', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('short-circuits empty query without invoke', async () => {
    const r = await workspaceFileSearch({ root: '/proj', query: '' })
    expect(r.hits).toEqual([])
    expect(r.truncated).toBe(false)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('invokes Tauri for non-empty query', async () => {
    invoke.mockResolvedValue({
      root: '/proj',
      query: 'foo',
      hits: [{ relativePath: 'foo.ts', absolutePath: '/proj/foo.ts', name: 'foo.ts', isDir: false, score: 0 }],
      truncated: false,
    })
    const r = await workspaceFileSearch({ root: '/proj', query: 'foo', limit: 20 })
    expect(invoke).toHaveBeenCalledWith('workspace_file_search', {
      root: '/proj',
      query: 'foo',
      limit: 20,
      includeDirs: undefined,
    })
    expect(r.hits).toHaveLength(1)
  })
})
