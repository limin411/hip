import { describe, it, expect } from 'vitest'
import type {
  PermissionMode,
  SessionConfig,
  AgentConfig,
  ClientMessage,
  ServerMessage,
} from './index.js'

// NOTE on coverage: vitest (esbuild) strips TS types, so the annotations in the `it` blocks below
// are NOT type-checked here — the type CONTRACT is enforced by `tsc` (root `yarn type-check` +
// the sidecar's `tsc --noEmit`). These runtime assertions guard the SHAPE: the three mode literals
// exist and permissionMode survives JSON serialization on SessionConfig (what the WS transport relies on).
//
// TYPE GUARD (checked only by tsc, NOT by vitest): the `satisfies` line below pins PermissionMode to
// exactly the three literals — if a fourth literal is added or one is removed/renamed, `tsc` fails.
const _modeGuard = (['chat', 'edit', 'full'] as const) satisfies readonly PermissionMode[]
void _modeGuard

describe('protocol: PermissionMode', () => {
  it('admits exactly the three mode literals', () => {
    const modes: PermissionMode[] = ['chat', 'edit', 'full']
    expect(modes).toEqual(['chat', 'edit', 'full'])
  })

  it('SessionConfig carries an optional permissionMode that round-trips', () => {
    const cfg: SessionConfig = {
      llmProvider: 'deepseek',
      model: 'deepseek-chat',
      tools: [],
      permissionMode: 'full',
    }
    const round = JSON.parse(JSON.stringify(cfg)) as SessionConfig
    expect(round.permissionMode).toBe('full')
  })

  it('SessionConfig.permissionMode is optional (undefined ⇒ treated as edit by readers)', () => {
    const cfg: SessionConfig = {
      llmProvider: 'deepseek',
      model: 'deepseek-chat',
      tools: [],
    }
    expect(cfg.permissionMode).toBeUndefined()
  })
})

// TYPE GUARDS (checked only by tsc, NOT by vitest): these pin the new fields + message variants.
// Before impl, `yarn type-check` fails on these lines; after impl it passes.
const _agentGuard: Pick<AgentConfig, 'allowedSkills' | 'allowedMcpServers'> = {
  allowedSkills: ['pdf-tools'],
  allowedMcpServers: ['srv-1'],
}
void _agentGuard
const _setMsgGuard: Extract<ClientMessage, { type: 'session:setPermissionMode' }> = {
  type: 'session:setPermissionMode', sessionId: 's', permissionMode: 'chat',
}
void _setMsgGuard
const _echoMsgGuard: Extract<ServerMessage, { type: 'session:permissionMode' }> = {
  type: 'session:permissionMode', sessionId: 's', permissionMode: 'full',
}
void _echoMsgGuard

describe('protocol: AgentConfig skill/MCP allow-lists', () => {
  it('models an internal agent with allowedSkills + allowedMcpServers', () => {
    const a: AgentConfig = {
      id: 'helper', name: 'Helper', kind: 'internal', command: '', args: [],
      enabled: true,
      prompt: 'You help.',
      allowedSkills: ['pdf-tools'],
      allowedMcpServers: ['srv-1'],
    }
    const round = JSON.parse(JSON.stringify(a)) as AgentConfig
    expect(round.allowedSkills).toEqual(['pdf-tools'])
    expect(round.allowedMcpServers).toEqual(['srv-1'])
  })

  it('treats both allow-lists as optional (undefined ⇒ none)', () => {
    const a: AgentConfig = {
      id: 'bare', name: 'Bare', kind: 'internal', command: '', args: [],
      enabled: true, prompt: 'p',
    }
    expect(a.allowedSkills).toBeUndefined()
    expect(a.allowedMcpServers).toBeUndefined()
  })

  it('still admits the deprecated allowedTools field (back-compat)', () => {
    const a: AgentConfig = {
      id: 'legacy', name: 'Legacy', kind: 'internal', command: '', args: [],
      enabled: true, prompt: 'p',
      allowedTools: ['read_file', 'mcp__srv-1__*'],
    }
    expect(a.allowedTools).toEqual(['read_file', 'mcp__srv-1__*'])
  })
})

describe('protocol: permission-mode control-plane messages', () => {
  it('session:setPermissionMode (client) round-trips', () => {
    const m: ClientMessage = { type: 'session:setPermissionMode', sessionId: 's', permissionMode: 'chat' }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ClientMessage, { type: 'session:setPermissionMode' }>
    expect(rt.type).toBe('session:setPermissionMode')
    expect(rt.sessionId).toBe('s')
    expect(rt.permissionMode).toBe('chat')
  })

  it('session:permissionMode (server) round-trips', () => {
    const m: ServerMessage = { type: 'session:permissionMode', sessionId: 's', permissionMode: 'full' }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ServerMessage, { type: 'session:permissionMode' }>
    expect(rt.type).toBe('session:permissionMode')
    expect(rt.sessionId).toBe('s')
    expect(rt.permissionMode).toBe('full')
  })
})
