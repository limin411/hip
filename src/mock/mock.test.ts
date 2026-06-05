import { describe, it, expect } from 'vitest'
import { mockSessions } from './sessions'
import { mockAgents, seedAgents } from './agents'
import { mockDiff } from './diff'
import { mockFileTree } from './fileTree'

describe('mock data integrity', () => {
  it('sessions have unique ids', () => {
    const ids = mockSessions.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('seedAgents starts supervisor running, children idle', () => {
    const agents = seedAgents()
    expect(agents[0].role).toBe('supervisor')
    expect(agents[0].status).toBe('running')
    expect(agents.slice(1).every((a) => a.status === 'idle')).toBe(true)
  })

  it('mockAgents covers all four roles', () => {
    const roles = mockAgents.map((a) => a.role)
    expect(roles).toEqual(['supervisor', 'planner', 'coder', 'reviewer'])
  })

  it('diff additions/deletions match line counts', () => {
    for (const file of mockDiff) {
      expect(file.lines.filter((l) => l.type === 'add').length).toBe(file.additions)
      expect(file.lines.filter((l) => l.type === 'del').length).toBe(file.deletions)
    }
  })

  it('file tree root is a directory with children', () => {
    expect(mockFileTree.type).toBe('dir')
    expect(mockFileTree.children?.length).toBeGreaterThan(0)
  })
})
