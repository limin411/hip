import { beforeEach, describe, expect, it } from 'vitest'
import type { WorktreeInfo, WorktreeRecord } from '@hip/protocol'
import { useWorktreeStore } from './worktreeStore'

function managedInfo(partial: Partial<WorktreeInfo> & Pick<WorktreeInfo, 'path' | 'id'>): WorktreeInfo {
  return {
    branch: partial.branch ?? 'b',
    head: partial.head ?? 'abc',
    managed: true,
    isPrimary: false,
    source: 'parallel',
    repoKey: 'repo-1',
    ...partial,
  }
}

describe('worktreeStore', () => {
  beforeEach(() => {
    useWorktreeStore.getState().clear()
  })

  it('applyChanged removed drops catalog row by id and path', () => {
    useWorktreeStore.getState().upsertFromList(
      [
        managedInfo({ id: 'id-a', path: '/wt/a', branch: 'a' }),
        managedInfo({ id: 'id-b', path: '/wt/b', branch: 'b' }),
      ],
      'host',
    )
    expect(Object.keys(useWorktreeStore.getState().byId)).toHaveLength(2)

    const record: WorktreeRecord = {
      id: 'id-a',
      path: '/wt/a',
      branch: '',
      head: '',
      repoKey: 'repo-1',
      isPrimary: false,
      managed: true,
      source: 'parallel',
    }
    useWorktreeStore.getState().applyChanged(record, 'removed')
    const ids = Object.keys(useWorktreeStore.getState().byId)
    expect(ids).toEqual(['id-b'])
  })

  it('upsertFromList prunes managed rows missing from the snapshot for the same repo', () => {
    useWorktreeStore.getState().upsertFromList(
      [
        managedInfo({ id: 'id-0', path: '/wt/0', branch: 'hip-parallel-0' }),
        managedInfo({ id: 'id-1', path: '/wt/1', branch: 'hip-parallel-1' }),
        {
          id: 'primary',
          path: '/repo',
          branch: 'main',
          head: 'h',
          managed: false,
          isPrimary: true,
          source: 'primary',
          repoKey: 'repo-1',
        },
      ],
      'host',
    )
    // Second snapshot: only primary + one managed remain (other worktree deleted on disk).
    useWorktreeStore.getState().upsertFromList(
      [
        {
          id: 'primary',
          path: '/repo',
          branch: 'main',
          head: 'h',
          managed: false,
          isPrimary: true,
          source: 'primary',
          repoKey: 'repo-1',
        },
        managedInfo({ id: 'id-1', path: '/wt/1', branch: 'hip-parallel-1' }),
      ],
      'host',
    )
    const byId = useWorktreeStore.getState().byId
    expect(byId['id-0']).toBeUndefined()
    expect(byId['id-1']?.path).toBe('/wt/1')
    expect(byId['primary']?.isPrimary).toBe(true)
  })

  it('upsertFromList does not prune rows from a different repoKey', () => {
    useWorktreeStore.getState().upsertFromList(
      [managedInfo({ id: 'other', path: '/other/wt', repoKey: 'repo-other', branch: 'x' })],
      'host-a',
    )
    useWorktreeStore.getState().upsertFromList(
      [
        {
          id: 'p',
          path: '/repo',
          branch: 'main',
          head: 'h',
          managed: false,
          isPrimary: true,
          source: 'primary',
          repoKey: 'repo-1',
        },
      ],
      'host-b',
    )
    expect(useWorktreeStore.getState().byId['other']?.path).toBe('/other/wt')
  })

  it('catalogForHost does not leak another host’s managed trees via source enum', () => {
    useWorktreeStore.getState().upsertFromList(
      [
        {
          id: 'p-a',
          path: '/repo-a',
          branch: 'main',
          head: 'h',
          managed: false,
          isPrimary: true,
          source: 'primary',
          repoKey: 'repo-a',
        },
        managedInfo({
          id: 'wt-a',
          path: '/wt/a',
          repoKey: 'repo-a',
          branch: 'iso-a',
          source: 'protocol',
        }),
      ],
      'host-a',
    )
    useWorktreeStore.getState().upsertFromList(
      [
        {
          id: 'p-b',
          path: '/repo-b',
          branch: 'main',
          head: 'h',
          managed: false,
          isPrimary: true,
          source: 'primary',
          repoKey: 'repo-b',
        },
        managedInfo({
          id: 'wt-b',
          path: '/wt/b',
          repoKey: 'repo-b',
          branch: 'iso-b',
          source: 'parallel',
        }),
      ],
      'host-b',
    )

    const forA = useWorktreeStore.getState().catalogForHost('host-a')
    const forB = useWorktreeStore.getState().catalogForHost('host-b')
    expect(forA.map((r) => r.id).sort()).toEqual(['p-a', 'wt-a'])
    expect(forB.map((r) => r.id).sort()).toEqual(['p-b', 'wt-b'])
    expect(forA.some((r) => r.id === 'wt-b')).toBe(false)
    expect(forB.some((r) => r.id === 'wt-a')).toBe(false)
  })
})
