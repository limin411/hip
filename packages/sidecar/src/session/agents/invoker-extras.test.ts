import { describe, it, expect } from 'vitest'
import type { SkillMeta } from '@hip/protocol'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { GraphEmit } from '../graph.js'
import { createAgentInvoker, type RunInternalArgs } from './invoker.js'
import type { ApprovalFn } from '../tools.js'

const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {} }
const approval: ApprovalFn = async () => ({ kind: 'allow_once' })

const skills: SkillMeta[] = [
  { id: 'fmt', name: 'formatter', description: 'd', dir: '/s/fmt', hasScripts: true },
  { id: 'lint', name: 'linter', description: 'd', dir: '/s/lint', hasScripts: false },
]
function fakeMcp(name: string): StructuredToolInterface { return { name } as unknown as StructuredToolInterface }
const mcpTools: StructuredToolInterface[] = [fakeMcp('mcp__fs__read'), fakeMcp('mcp__fs__write'), fakeMcp('mcp__db__query')]

describe('AgentInvoker pre-filters extras for an internal agent', () => {
  it('narrows skills to agent.allowedSkills and mcpTools to agent.allowedMcpServers', async () => {
    let captured: RunInternalArgs | null = null
    const invoker = createAgentInvoker('/proj', {
      readAgents: () => [
        { id: 'inner', name: 'Inner', enabled: true, kind: 'internal', prompt: 'p', allowedSkills: ['fmt'], allowedMcpServers: ['fs'] } as never,
      ],
      runInternal: async (a) => { captured = a; return 'done' },
    })
    const text = await invoker.invoke('inner', 'do it', noopEmit, new AbortController().signal, undefined, { mcpTools, skills, requestApproval: approval, permissionMode: 'full' })
    expect(text).toBe('done')
    expect(captured!.skills!.map((s) => s.id)).toEqual(['fmt'])
    expect(captured!.mcpTools!.map((t) => t.name)).toEqual(['mcp__fs__read', 'mcp__fs__write'])
    expect(captured!.requestApproval).toBe(approval)
    expect(captured!.permissionMode).toBe('full')
  })

  it('grants no skills/mcp when the agent has none configured', async () => {
    let captured: RunInternalArgs | null = null
    const invoker = createAgentInvoker('/proj', {
      readAgents: () => [{ id: 'inner', name: 'Inner', enabled: true, kind: 'internal', prompt: 'p' } as never],
      runInternal: async (a) => { captured = a; return 'ok' },
    })
    await invoker.invoke('inner', 't', noopEmit, new AbortController().signal, undefined, { mcpTools, skills, requestApproval: approval })
    expect(captured!.skills).toEqual([])
    expect(captured!.mcpTools).toEqual([])
  })

  it('back-compat: derives allowedMcpServers from legacy allowedTools mcp__<id>__* when undefined', async () => {
    let captured: RunInternalArgs | null = null
    const invoker = createAgentInvoker('/proj', {
      readAgents: () => [
        { id: 'inner', name: 'Inner', enabled: true, kind: 'internal', prompt: 'p', allowedTools: ['read_file', 'mcp__db__*'] } as never,
      ],
      runInternal: async (a) => { captured = a; return 'ok' },
    })
    await invoker.invoke('inner', 't', noopEmit, new AbortController().signal, undefined, { mcpTools, skills, requestApproval: approval })
    // allowedSkills undefined ⇒ none; allowedMcpServers undefined ⇒ derived from the db wildcard.
    expect(captured!.skills).toEqual([])
    expect(captured!.mcpTools!.map((t) => t.name)).toEqual(['mcp__db__query'])
  })

  it('tolerates being called without extras (back-compat)', async () => {
    let captured: RunInternalArgs | null = null
    const invoker = createAgentInvoker('/proj', {
      readAgents: () => [{ id: 'inner', name: 'Inner', enabled: true, kind: 'internal', prompt: 'p' } as never],
      runInternal: async (a) => { captured = a; return 'ok' },
    })
    const text = await invoker.invoke('inner', 't', noopEmit, new AbortController().signal)
    expect(text).toBe('ok')
    expect(captured!.skills).toBeUndefined()
    expect(captured!.mcpTools).toBeUndefined()
    expect(captured!.requestApproval).toBeUndefined()
    expect(captured!.permissionMode).toBeUndefined()
  })
})
