import { describe, expect, it } from 'vitest'
import type { HostGroup, TerminalHost } from '@/ipc/terminalHosts'
import {
  filterHostsByQuery,
  groupNamesEqual,
  HOST_LIST_PAGE_SIZE,
  hostListTotalPages,
  hostMatchesQuery,
  isDuplicateGroupName,
  paginateHosts,
  sortGroupsByName,
} from './hostGroupUi'

const host = (partial: Partial<TerminalHost> & Pick<TerminalHost, 'id' | 'label'>): TerminalHost => ({
  hostname: 'db.example',
  port: 22,
  username: 'deploy',
  authMethod: 'password',
  updatedAt: 1,
  ...partial,
})

const g = (id: string, name: string, sort = 0): HostGroup => ({ id, name, sort })

describe('hostGroupUi', () => {
  it('groupNamesEqual is case-insensitive', () => {
    expect(groupNamesEqual('Prod', 'prod')).toBe(true)
    expect(groupNamesEqual('  Dev ', 'dev')).toBe(true)
    expect(groupNamesEqual('a', 'b')).toBe(false)
  })

  it('isDuplicateGroupName detects collisions and allows rename of self', () => {
    const groups = [g('g1', 'Prod'), g('g2', 'Dev')]
    expect(isDuplicateGroupName('prod', groups)).toBe(true)
    expect(isDuplicateGroupName('Staging', groups)).toBe(false)
    expect(isDuplicateGroupName('Prod', groups, 'g1')).toBe(false)
    expect(isDuplicateGroupName('dev', groups, 'g1')).toBe(true)
    expect(isDuplicateGroupName('  ', groups)).toBe(false)
  })

  it('sortGroupsByName orders by name ascending ignoring sort field', () => {
    const groups = [g('g1', 'Prod', 0), g('g2', 'alpha', 99), g('g3', 'Dev', 1)]
    expect(sortGroupsByName(groups).map((x) => x.name)).toEqual(['alpha', 'Dev', 'Prod'])
  })

  it('hostMatchesQuery matches label, hostname, username, user@host, host:port, remotePath', () => {
    const h = host({
      id: 'h1',
      label: 'Prod DB',
      hostname: 'db.internal',
      port: 2222,
      username: 'ops',
      remotePath: '/srv/app',
    })
    expect(hostMatchesQuery(h, '')).toBe(true)
    expect(hostMatchesQuery(h, '  prod  ')).toBe(true)
    expect(hostMatchesQuery(h, 'DB.INTERNAL')).toBe(true)
    expect(hostMatchesQuery(h, 'ops')).toBe(true)
    expect(hostMatchesQuery(h, 'ops@db.internal')).toBe(true)
    expect(hostMatchesQuery(h, 'db.internal:2222')).toBe(true)
    expect(hostMatchesQuery(h, '/srv/app')).toBe(true)
    expect(hostMatchesQuery(h, 'nope')).toBe(false)
    expect(hostMatchesQuery(h, '2222')).toBe(true)
  })

  it('does not match a port fragment across unrelated fields', () => {
    const h = host({ id: 'h1', label: 'web', hostname: 'a.example', port: 22, username: 'u' })
    expect(hostMatchesQuery(h, 'a.example:22')).toBe(true)
    expect(hostMatchesQuery(h, 'webu')).toBe(false)
  })

  it('filterHostsByQuery returns a copy when query is empty', () => {
    const hosts = [
      host({ id: 'h1', label: 'alpha', hostname: 'one.example' }),
      host({ id: 'h2', label: 'bravo', hostname: 'two.example' }),
    ]
    const filtered = filterHostsByQuery(hosts, '  ')
    expect(filtered).toEqual(hosts)
    expect(filtered).not.toBe(hosts)
    expect(filterHostsByQuery(hosts, 'bravo').map((x) => x.id)).toEqual(['h2'])
  })

  it('paginates hosts and reports at least one page', () => {
    expect(hostListTotalPages(0)).toBe(1)
    expect(hostListTotalPages(HOST_LIST_PAGE_SIZE)).toBe(1)
    expect(hostListTotalPages(HOST_LIST_PAGE_SIZE + 1)).toBe(2)
    const items = Array.from({ length: HOST_LIST_PAGE_SIZE + 4 }, (_, i) => i)
    expect(paginateHosts(items, 1)).toEqual(items.slice(0, HOST_LIST_PAGE_SIZE))
    expect(paginateHosts(items, 2)).toEqual(items.slice(HOST_LIST_PAGE_SIZE))
    expect(paginateHosts(items, 0)).toEqual(items.slice(0, HOST_LIST_PAGE_SIZE))
  })
})
