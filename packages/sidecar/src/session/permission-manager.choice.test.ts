import { describe, it, expect, vi } from 'vitest'
import { PermissionManager } from './permission-manager.js'

describe('PermissionManager.requestChoice', () => {
  it('resolves the selected optionId', async () => {
    let mode: 'edit' | 'chat' | 'full' = 'edit'
    const pm = new PermissionManager(
      () => mode,
      (m) => {
        mode = m
        return true
      },
    )
    const send = vi.fn()
    const p = pm.requestChoice(
      send,
      's1',
      't1',
      () => 1,
      { title: 'Parallel', kind: 'parallel_worktrees', content: 'why' },
      [
        { optionId: 'n2', name: '2', kind: 'allow_once' },
        { optionId: 'reject', name: 'No', kind: 'reject_once' },
      ],
    )
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'permission:request',
        tool: expect.objectContaining({ kind: 'parallel_worktrees' }),
      }),
    )
    const requestId = (send.mock.calls[0]![0] as { requestId: string }).requestId
    pm.respondPermission(requestId, { optionId: 'n2' })
    await expect(p).resolves.toEqual({ optionId: 'n2' })
  })

  it('resolves cancelled when dismissed', async () => {
    const pm = new PermissionManager(
      () => 'edit',
      () => true,
    )
    const send = vi.fn()
    const p = pm.requestChoice(
      send,
      's1',
      't1',
      () => 2,
      { title: 'X', kind: 'k' },
      [{ optionId: 'a', name: 'A', kind: 'allow_once' }],
    )
    const requestId = (send.mock.calls[0]![0] as { requestId: string }).requestId
    pm.respondPermission(requestId, { cancelled: true })
    await expect(p).resolves.toEqual({ cancelled: true })
  })
})
