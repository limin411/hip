import { describe, it, expect, beforeEach } from 'vitest'
import { useDraftStore } from './draftStore'

beforeEach(() => useDraftStore.setState({ draft: null }))

describe('draftStore', () => {
  it('ensureDraft creates a singleton chat draft and returns the same on repeat', () => {
    const a = useDraftStore.getState().ensureDraft()
    const b = useDraftStore.getState().ensureDraft()
    expect(a.tempId).toBe(b.tempId)
    expect(a.mode).toBe('chat')
  })
  it('ensureDraft("code") creates a project mode draft', () => {
    const d = useDraftStore.getState().ensureDraft('code')
    expect(d.mode).toBe('project')
  })
  it('ensureDraft("chat") creates a chat mode draft', () => {
    const d = useDraftStore.getState().ensureDraft('chat')
    expect(d.mode).toBe('chat')
  })
  it('ensureDraft("code") switches an existing chat draft to project and keeps cwd', () => {
    useDraftStore.setState({ draft: { tempId: 't1', mode: 'chat', text: '', cwd: '/keep' } })
    const d = useDraftStore.getState().ensureDraft('code')
    expect(d.mode).toBe('project')
    expect(d.cwd).toBe('/keep')
  })
  it('ensureDraft("chat") switches an existing project draft to chat and clears cwd', () => {
    useDraftStore.setState({ draft: { tempId: 't2', mode: 'project', text: '', cwd: '/drop' } })
    const d = useDraftStore.getState().ensureDraft('chat')
    expect(d.mode).toBe('chat')
    expect(d.cwd).toBeUndefined()
  })
  it('setText updates the draft text', () => {
    useDraftStore.getState().ensureDraft()
    useDraftStore.getState().setText('hello')
    expect(useDraftStore.getState().draft?.text).toBe('hello')
  })
  it('pickProject sets project mode + cwd (creating a draft if none)', () => {
    useDraftStore.getState().pickProject('/proj')
    expect(useDraftStore.getState().draft).toMatchObject({ mode: 'project', cwd: '/proj' })
  })
  it('clearProject reverts to chat mode', () => {
    useDraftStore.getState().pickProject('/proj')
    useDraftStore.getState().clearProject()
    expect(useDraftStore.getState().draft).toMatchObject({ mode: 'chat', cwd: undefined })
  })
  it('reset clears the draft', () => {
    useDraftStore.getState().ensureDraft()
    useDraftStore.getState().reset()
    expect(useDraftStore.getState().draft).toBeNull()
  })
  it('setRoundtable arms chat drafts and clears with false', () => {
    useDraftStore.getState().ensureDraft('chat')
    useDraftStore.getState().setRoundtable(true)
    expect(useDraftStore.getState().draft?.roundtable).toBe(true)
    useDraftStore.getState().setRoundtable(false)
    expect(useDraftStore.getState().draft?.roundtable).toBeUndefined()
  })
  it('setRoundtable(true) does not stick on project drafts', () => {
    useDraftStore.getState().ensureDraft('code')
    useDraftStore.getState().setRoundtable(true)
    expect(useDraftStore.getState().draft?.roundtable).toBeUndefined()
  })
  it('setControlPermission arms chat drafts and clears with false', () => {
    useDraftStore.getState().ensureDraft('chat')
    useDraftStore.getState().setControlPermission(true)
    expect(useDraftStore.getState().draft?.controlPermission).toBe(true)
    useDraftStore.getState().setControlPermission(false)
    expect(useDraftStore.getState().draft?.controlPermission).toBeUndefined()
  })
  it('setControlPermission(true) does not stick on project drafts', () => {
    useDraftStore.getState().ensureDraft('code')
    useDraftStore.getState().setControlPermission(true)
    expect(useDraftStore.getState().draft?.controlPermission).toBeUndefined()
  })
  it('setRoundtable(true) clears controlPermission (mode radio group)', () => {
    useDraftStore.getState().ensureDraft('chat')
    useDraftStore.getState().setControlPermission(true)
    expect(useDraftStore.getState().draft?.controlPermission).toBe(true)
    useDraftStore.getState().setRoundtable(true)
    expect(useDraftStore.getState().draft?.roundtable).toBe(true)
    expect(useDraftStore.getState().draft?.controlPermission).toBeUndefined()
  })
  it('setControlPermission(true) clears roundtable (mode radio group)', () => {
    useDraftStore.getState().ensureDraft('chat')
    useDraftStore.getState().setRoundtable(true)
    expect(useDraftStore.getState().draft?.roundtable).toBe(true)
    useDraftStore.getState().setControlPermission(true)
    expect(useDraftStore.getState().draft?.controlPermission).toBe(true)
    expect(useDraftStore.getState().draft?.roundtable).toBeUndefined()
  })
})

describe('draftStore agentId', () => {
  it('setAgentId creates a draft if none and records the agent', () => {
    useDraftStore.getState().setAgentId('agent-1')
    expect(useDraftStore.getState().draft?.agentId).toBe('agent-1')
  })
  it('setAgentId preserves project fields and clears hip-only controls for external agent', () => {
    useDraftStore.getState().pickProject('/tmp/x')
    useDraftStore.getState().setModelKey('openai/gpt-4o')
    useDraftStore.getState().setForcePlan(true)
    useDraftStore.getState().setEffort('high')
    useDraftStore.getState().setAgentId('agent-2')
    const d = useDraftStore.getState().draft!
    expect(d.cwd).toBe('/tmp/x')
    expect(d.mode).toBe('project')
    expect(d.agentId).toBe('agent-2')
    expect(d.modelKey).toBeUndefined()
    expect(d.forcePlan).toBeUndefined()
    expect(d.effort).toBeUndefined()
  })
  it('setAgentId(builtin) clears agentId field', () => {
    useDraftStore.getState().setAgentId('agent-3')
    useDraftStore.getState().setAgentId('builtin')
    expect(useDraftStore.getState().draft?.agentId).toBeUndefined()
    expect('agentId' in (useDraftStore.getState().draft ?? {})).toBe(false)
  })
  it('reset clears agentId', () => {
    useDraftStore.getState().setAgentId('agent-3')
    useDraftStore.getState().reset()
    expect(useDraftStore.getState().draft).toBeNull()
  })
})

describe('draftStore permissionMode', () => {
  it('setPermissionMode creates a draft if none and records the mode', () => {
    useDraftStore.getState().setPermissionMode('full')
    expect(useDraftStore.getState().draft?.permissionMode).toBe('full')
  })
  it('setPermissionMode preserves existing draft fields', () => {
    useDraftStore.getState().pickProject('/tmp/x')
    useDraftStore.getState().setPermissionMode('chat')
    const d = useDraftStore.getState().draft!
    expect(d.cwd).toBe('/tmp/x')
    expect(d.mode).toBe('project')
    expect(d.permissionMode).toBe('chat')
  })
  it('reset clears the draft (and with it permissionMode)', () => {
    useDraftStore.getState().setPermissionMode('edit')
    expect(useDraftStore.getState().draft?.permissionMode).toBe('edit')
    useDraftStore.getState().reset()
    expect(useDraftStore.getState().draft).toBeNull()
  })
  it('leaving full clears autopilot', () => {
    useDraftStore.getState().setPermissionMode('full')
    expect(useDraftStore.getState().setExecutionMode('autopilot')).toBe(true)
    expect(useDraftStore.getState().draft?.executionMode).toBe('autopilot')
    useDraftStore.getState().setPermissionMode('edit')
    expect(useDraftStore.getState().draft?.executionMode).toBe('interactive')
    expect(useDraftStore.getState().draft?.forcePlan).toBe(false)
  })
  it('rejects autopilot without full', () => {
    useDraftStore.getState().setPermissionMode('edit')
    expect(useDraftStore.getState().setExecutionMode('autopilot')).toBe(false)
  })
})
