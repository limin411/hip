import { describe, it, expect } from 'vitest'
import { fsScopeOf } from './useFsScope'
import type { SessionVM } from '@/domain'
import type { Draft } from '@/store/draftStore'

const session = (id: string, cwd?: string): SessionVM => ({
  id, config: { llmProvider: 'deepseek', model: 'm', tools: [], cwd },
  title: 'T', preview: '', updatedAt: 'now', updatedAtMs: 0, loaded: true,
  messages: [], agents: [], status: 'idle', error: null,
})
const projectDraft: Draft = { tempId: 'd', mode: 'project', cwd: '/q', text: '' }
const chatDraft: Draft = { tempId: 'd', mode: 'chat', text: '' }

describe('fsScopeOf', () => {
  it('a committed session wins over any draft (keyed by id, its cwd)', () => {
    expect(fsScopeOf(session('s1', '/p'), projectDraft)).toEqual({ scopeId: 's1', cwd: '/p', isDraft: false, chatDraft: false })
  })
  it('project draft when no active session (keyed by cwd, isDraft)', () => {
    expect(fsScopeOf(null, projectDraft)).toEqual({ scopeId: '/q', cwd: '/q', isDraft: true, chatDraft: false })
  })
  it('chat draft → no scope, chatDraft true', () => {
    expect(fsScopeOf(null, chatDraft)).toEqual({ scopeId: null, cwd: undefined, isDraft: false, chatDraft: true })
  })
  it('nothing selected → empty scope', () => {
    expect(fsScopeOf(null, null)).toEqual({ scopeId: null, cwd: undefined, isDraft: false, chatDraft: false })
  })
})
