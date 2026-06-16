import { describe, it, expect } from 'vitest'
import type { SkillMeta } from '@hip/protocol'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { GraphEmit } from '../graph.js'
import { createAgentInvoker, type RunInternalArgs } from './invoker.js'
import type { ApprovalFn } from '../tools.js'

const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {} }
const skills: SkillMeta[] = [{ id: 'fmt', name: 'formatter', description: 'd', dir: '/s/fmt', hasScripts: true }]
const mcpTools: StructuredToolInterface[] = []
const approval: ApprovalFn = async () => ({ kind: 'allow_once' })

describe('AgentInvoker forwards extras to the internal runner', () => {
  it('passes skills/mcpTools/requestApproval into runInternal for an internal agent', async () => {
    let captured: RunInternalArgs | null = null
    const invoker = createAgentInvoker('/proj', {
      readAgents: () => [
        { id: 'inner', name: 'Inner', enabled: true, kind: 'internal', prompt: 'p', allowedTools: ['use_skill', 'run_script'] } as never,
      ],
      runInternal: async (a) => { captured = a; return 'done' },
    })
    const text = await invoker.invoke('inner', 'do it', noopEmit, new AbortController().signal, undefined, { mcpTools, skills, requestApproval: approval })
    expect(text).toBe('done')
    expect(captured!.skills).toBe(skills)
    expect(captured!.mcpTools).toBe(mcpTools)
    expect(captured!.requestApproval).toBe(approval)
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
    expect(captured!.requestApproval).toBeUndefined()
  })
})
