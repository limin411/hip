import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'm', tools: [] }
let scratchRoot: string
beforeEach(() => { scratchRoot = mkdtempSync(path.join(os.tmpdir(), 'hip-pftest-')) })
afterEach(() => { rmSync(scratchRoot, { recursive: true, force: true }) })

function mgr(): SessionManager {
  return new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }), scratchRoot)
}

describe('SessionManager agent profiles', () => {
  it('agent:setProfile with valid id switches profile and emits agent:profiles', () => {
    const m = mgr()
    const sent: ServerMessage[] = []
    m.handle({ type: 'session:create', id: 's1', config: cfg }, (msg) => sent.push(msg))

    sent.length = 0
    m.handle({ type: 'agent:setProfile', sessionId: 's1', id: 'plan' }, (msg) => sent.push(msg))

    const profilesMsg = sent.find((msg) => msg.type === 'agent:profiles') as
      | Extract<ServerMessage, { type: 'agent:profiles' }>
      | undefined
    expect(profilesMsg).toBeDefined()
    expect(profilesMsg!.profiles).toHaveLength(4)
    expect(profilesMsg!.sessionId).toBe('s1')
    expect(sent.some((msg) => msg.type === 'error')).toBe(false)
  })

  it('agent:setProfile with invalid id emits error code INVALID_PROFILE', () => {
    const m = mgr()
    const sent: ServerMessage[] = []
    m.handle({ type: 'session:create', id: 's1', config: cfg }, (msg) => sent.push(msg))

    sent.length = 0
    m.handle({ type: 'agent:setProfile', sessionId: 's1', id: 'nonexistent' }, (msg) => sent.push(msg))

    const errMsg = sent.find((msg) => msg.type === 'error') as
      | Extract<ServerMessage, { type: 'error' }>
      | undefined
    expect(errMsg).toBeDefined()
    expect(errMsg!.code).toBe('INVALID_PROFILE')
    expect(errMsg!.sessionId).toBe('s1')
    expect(sent.some((msg) => msg.type === 'agent:profiles')).toBe(false)
  })

  it('agent:profiles includes exactly the 4 builtin profiles', () => {
    const m = mgr()
    const sent: ServerMessage[] = []
    m.handle({ type: 'session:create', id: 's1', config: cfg }, (msg) => sent.push(msg))

    sent.length = 0
    m.handle({ type: 'agent:setProfile', sessionId: 's1', id: 'supervisor' }, (msg) => sent.push(msg))

    const profilesMsg = sent.find((msg) => msg.type === 'agent:profiles') as
      | Extract<ServerMessage, { type: 'agent:profiles' }>
      | undefined
    expect(profilesMsg).toBeDefined()
    const { profiles } = profilesMsg!
    expect(profiles).toHaveLength(4)

    const byId = new Map(profiles.map((p) => [p.id, p]))
    expect(byId.get('supervisor')).toMatchObject({ id: 'supervisor', name: 'Supervisor', mode: 'primary' })
    expect(byId.get('plan')).toMatchObject({ id: 'plan', name: 'Plan', mode: 'primary' })
    expect(byId.get('explore')).toMatchObject({ id: 'explore', name: 'Explore', mode: 'primary' })
    expect(byId.get('worker')).toMatchObject({ id: 'worker', name: 'Worker', mode: 'subagent' })
  })
})
