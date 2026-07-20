import { describe, expect, it } from 'vitest'
import type { HostGroup } from '@/ipc/terminalHosts'
import {
  groupNamesEqual,
  isDuplicateGroupName,
  sortGroupsByName,
} from './hostGroupUi'

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
})
