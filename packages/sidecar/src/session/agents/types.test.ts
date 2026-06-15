import { describe, it, expect } from 'vitest'
import type { AgentProvider, ExternalAgentHooks } from './types.js'
import type { GraphEmit } from '../graph.js'

describe('AgentProvider widened contract', () => {
  it('allows an optional hooks arg and optional control methods', () => {
    const hooks: ExternalAgentHooks = { requestPermission: async () => ({ cancelled: true }), configOptions: () => {} }
    // Per the plan note, pending-permission state lives in Session (Session.respondPermission),
    // NOT on AgentProvider — so the provider object exposes only runTurn/dispose/setConfigOption.
    const p: AgentProvider = {
      async runTurn(_t: string, _e: GraphEmit, _s: AbortSignal, _h?: ExternalAgentHooks) {},
      dispose() {},
      async setConfigOption() {},
    }
    expect(typeof p.runTurn).toBe('function')
    expect(hooks).toBeTruthy()
  })
})
