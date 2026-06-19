import { describe, it, expect } from 'vitest'
import { buildTools, type ApprovalFn } from './tools.js'
import type { ToolPermissionConfig } from '@hip/protocol'

const autoApprove: ApprovalFn = () => Promise.resolve({ kind: 'allow_once' })
const autoReject: ApprovalFn = () => Promise.resolve({ kind: 'reject_once' })

function build(opts: Partial<Parameters<typeof buildTools>[4]> = {}) {
  return buildTools('/tmp/test', undefined, '/tmp/test', undefined, opts)
}

describe('per-tool permission gating', () => {
  it('auto mode runs tools without HITL', async () => {
    const tp: ToolPermissionConfig = { defaultMode: 'auto' }
    const tools = build({ toolPermissions: tp })
    const ls = tools.find((t) => t.name === 'ls')!
    const result = await ls.invoke({ path: '/' })
    expect(result).toBeTypeOf('string')
  })

  it('deny mode blocks tools', async () => {
    const tp: ToolPermissionConfig = { defaultMode: 'deny' }
    const tools = build({ toolPermissions: tp })
    const ls = tools.find((t) => t.name === 'ls')!
    const result = await ls.invoke({ path: '/' })
    expect(result).toContain('blocked by permission policy')
  })

  it('prompt mode triggers HITL and runs when approved', async () => {
    const tp: ToolPermissionConfig = { defaultMode: 'prompt' }
    const tools = build({ toolPermissions: tp, requestApproval: autoApprove })
    const ls = tools.find((t) => t.name === 'ls')!
    const result = await ls.invoke({ path: '/' })
    expect(result).toBeTypeOf('string')
  })

  it('prompt mode blocks when user rejects', async () => {
    const tp: ToolPermissionConfig = { defaultMode: 'prompt' }
    const tools = build({ toolPermissions: tp, requestApproval: autoReject })
    const ls = tools.find((t) => t.name === 'ls')!
    const result = await ls.invoke({ path: '/' })
    expect(result).toContain('拒绝')
  })

  it('approve mode triggers HITL, records grant, then auto-runs', async () => {
    const tp: ToolPermissionConfig = { defaultMode: 'approve' }
    const approved = new Set<string>()
    const tools = build({
      toolPermissions: tp,
      requestApproval: autoApprove,
      recordApproved: (name) => approved.add(name),
      isApproved: (name) => approved.has(name),
    })
    const ls = tools.find((t) => t.name === 'ls')!

    // First call: should trigger HITL and record approval
    const r1 = await ls.invoke({ path: '/' })
    expect(r1).toBeTypeOf('string')
    expect(approved.has('ls')).toBe(true)

    // Second call: should auto-run (sticky grant)
    const r2 = await ls.invoke({ path: '/' })
    expect(r2).toBeTypeOf('string')
  })

  it('tool override takes priority over defaultMode', async () => {
    const tp: ToolPermissionConfig = { defaultMode: 'auto', overrides: { write_file: 'deny' } }
    const tools = build({ toolPermissions: tp })
    const wf = tools.find((t) => t.name === 'write_file')!
    const result = await wf.invoke({ path: '/test.txt', content: 'hi' })
    expect(result).toContain('blocked by permission policy')
  })

  it('prompt mode with no requestApproval degrades to deny', async () => {
    const tp: ToolPermissionConfig = { defaultMode: 'prompt' }
    const tools = build({ toolPermissions: tp }) // no requestApproval
    const ls = tools.find((t) => t.name === 'ls')!
    const result = await ls.invoke({ path: '/' })
    expect(result).toContain('blocked by permission policy')
  })

  it('no toolPermissions returns unwrapped tools', () => {
    const tools = build() // no permission config
    expect(tools.length).toBeGreaterThan(0)
    // All tools should work normally
  })
})
