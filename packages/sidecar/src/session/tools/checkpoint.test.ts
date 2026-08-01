import { describe, it, expect, vi } from 'vitest'
import { buildAllTools } from './index.js'
import { buildCheckpointTools } from './checkpoint.js'
import type { Checkpoint } from '@hip/protocol'

function byName(tools: { name: string }[], name: string) {
  return tools.find((t) => t.name === name)
}

describe('buildCheckpointTools', () => {
  const cp: Checkpoint[] = [
    { id: 's1:t1', sessionId: 's1', turnId: 't1', kind: 'turn', label: 'add feature', treeSha: 't1', commitSha: 'abc123def456', branch: 'main', createdAt: 20 },
    { id: 's1:start', sessionId: 's1', turnId: null, kind: 'start', label: null, treeSha: 't0', commitSha: 'aabbcc', branch: 'main', createdAt: 10 },
  ]

  it('returns no tools without a cwd', () => {
    expect(buildCheckpointTools({})).toEqual([])
  })

  it('returns no tools when the revert/list closures are absent', () => {
    expect(buildCheckpointTools({ cwd: '/proj', sessionId: 's1' })).toEqual([])
  })

  it('git_checkpoint_list formats session checkpoints newest-first', async () => {
    const list = vi.fn().mockResolvedValue(cp)
    const revert = vi.fn()
    const [listTool, revertTool] = buildCheckpointTools({
      cwd: '/proj',
      sessionId: 's1',
      list,
      revert,
    }) as [NonNullable<ReturnType<typeof buildCheckpointTools>[0]>, NonNullable<ReturnType<typeof buildCheckpointTools>[1]>]

    expect(listTool.name).toBe('git_checkpoint_list')
    expect(revertTool.name).toBe('git_checkpoint_revert')

    const out = await listTool.invoke({})
    expect(out).toContain('s1:t1 (add feature) kind=turn branch=main sha=abc123d')
    expect(out).toContain('s1:start kind=start')
  })

  it('git_checkpoint_list reports no checkpoints yet', async () => {
    const [listTool] = buildCheckpointTools({
      cwd: '/proj',
      sessionId: 's1',
      list: async () => [],
      revert: vi.fn(),
    })
    const out = await listTool!.invoke({})
    expect(out).toContain('No checkpoints yet')
  })

  it('git_checkpoint_revert delegates to the safe revert closure', async () => {
    const revert = vi.fn().mockResolvedValue({ ok: true, safetyCheckpointId: 's1:pre-revert-1' })
    const [, revertTool] = buildCheckpointTools({
      cwd: '/proj',
      sessionId: 's1',
      list: async () => cp,
      revert,
    })
    const out = await revertTool!.invoke({ checkpointId: 's1:t1' })
    expect(revert).toHaveBeenCalledWith('s1:t1')
    expect(out).toContain('Reverted the workspace to checkpoint s1:t1')
    expect(out).toContain('safety checkpoint s1:pre-revert-1')
  })

  it('git_checkpoint_revert surfaces a failure', async () => {
    const [, revertTool] = buildCheckpointTools({
      cwd: '/proj',
      sessionId: 's1',
      list: async () => cp,
      revert: async () => ({ ok: false, error: 'checkpoint not found' }),
    })
    const out = await revertTool!.invoke({ checkpointId: 's1:nope' })
    expect(out).toContain('Error: checkpoint not found')
  })
})

describe('buildAllTools checkpoint registration', () => {
  it('registers checkpoint tools when allowGit and closures are provided', () => {
    const tools = buildAllTools('/tmp/proj', undefined, '/tmp/proj', undefined, {
      sessionId: 's1',
      onCheckpointList: async () => [],
      onCheckpointRevert: async () => ({ ok: true }),
    })
    expect(byName(tools, 'git_checkpoint_list')).toBeTruthy()
    expect(byName(tools, 'git_checkpoint_revert')).toBeTruthy()
  })

  it('does not register checkpoint tools when closures are absent', () => {
    const tools = buildAllTools('/tmp/proj', undefined, '/tmp/proj', undefined, {
      sessionId: 's1',
    })
    expect(byName(tools, 'git_checkpoint_list')).toBeUndefined()
    expect(byName(tools, 'git_checkpoint_revert')).toBeUndefined()
  })
})
