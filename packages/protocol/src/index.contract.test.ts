import { describe, it, expect } from 'vitest'
import type {
  SessionEvent,
  NetworkPolicyConfig,
  ClientMessage,
  ServerMessage,
  HookEvent,
  HookResult,
  SessionConfig,
} from './index.js'

// TYPE GUARDS (checked only by tsc, NOT by vitest): pin the exact unions so that
// adding/removing/renaming a variant breaks `yarn type-check`.
const _sessionEventGuard = (
  [
    'user_message',
    'step_started',
    'step_ended',
    'step_failed',
    'text_started',
    'text_ended',
    'tool_called',
    'tool_success',
    'tool_failed',
    'compaction_ended',
  ] as const
) satisfies readonly SessionEvent['type'][]
void _sessionEventGuard

const _hookEventGuard = (
  [
    'SessionStart',
    'TurnStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'TurnComplete',
    'Stop',
    'PermissionRequest',
    'ActivityStart',
    'ActivityEnd',
    'ActivityBudgetRequest',
  ] as const
) satisfies readonly HookEvent[]
void _hookEventGuard

const _inputEnqueueGuard: Extract<ClientMessage, { type: 'input:enqueue' }> = {
  type: 'input:enqueue',
  sessionId: 's',
  id: 'm1',
  content: 'hello',
}
void _inputEnqueueGuard

const _inputSteerGuard: Extract<ClientMessage, { type: 'input:steer' }> = {
  type: 'input:steer',
  sessionId: 's',
  id: 'm1',
  content: 'keep going',
}
void _inputSteerGuard

const _backgroundSubagentGuard: Extract<ClientMessage, { type: 'subagent:background' }> = {
  type: 'subagent:background',
  sessionId: 's',
  taskId: 't1',
  description: 'do work',
}
void _backgroundSubagentGuard

const _notificationGuard: Extract<ServerMessage, { type: 'agent:notification' }> = {
  type: 'agent:notification',
  sessionId: 's',
  taskId: 't1',
  description: 'do work',
  status: 'completed',
}
void _notificationGuard

const _workflowGetActive: Extract<ClientMessage, { type: 'workflow:getActive' }> = {
  type: 'workflow:getActive',
  sessionId: 's',
}
void _workflowGetActive

const _workflowRunWithInputs: Extract<ClientMessage, { type: 'workflow:run' }> = {
  type: 'workflow:run',
  sessionId: 's',
  def: { id: 'w', name: 'W', nodes: [], edges: [], entry: [] },
  runInputs: { text: 'hello' },
}
void _workflowRunWithInputs

const _workflowStarted: Extract<ServerMessage, { type: 'workflow:started' }> = {
  type: 'workflow:started',
  sessionId: 's',
  runId: 'r1',
  def: { id: 'w', name: 'W', nodes: [], edges: [], entry: [] },
}
void _workflowStarted

const _workflowEvent: Extract<ServerMessage, { type: 'workflow:event' }> = {
  type: 'workflow:event',
  sessionId: 's',
  runId: 'r1',
  event: { type: 'run:started' },
}
void _workflowEvent

const _workflowSnapshot: Extract<ServerMessage, { type: 'workflow:snapshot' }> = {
  type: 'workflow:snapshot',
  sessionId: 's',
  runId: 'r1',
  def: { id: 'w', name: 'W', nodes: [], edges: [], entry: [] },
  state: { runId: 'r1', workflowId: 'w', status: 'succeeded', nodes: {} },
}
void _workflowSnapshot

const _workflowCleared: Extract<ServerMessage, { type: 'workflow:cleared' }> = {
  type: 'workflow:cleared',
  sessionId: 's',
}
void _workflowCleared

// ──────────────────────────────────────────────────────────────────
// SessionEvent contract
// ──────────────────────────────────────────────────────────────────

describe('protocol: SessionEvent', () => {
  it('round-trips a user_message event', () => {
    const e: SessionEvent = {
      type: 'user_message',
      sessionId: 's1',
      messageId: 'm1',
      content: 'hello',
      timestamp: 1700000000000,
    }
    const rt = JSON.parse(JSON.stringify(e)) as Extract<SessionEvent, { type: 'user_message' }>
    expect(rt.type).toBe('user_message')
    expect(rt.sessionId).toBe('s1')
    expect(rt.messageId).toBe('m1')
    expect(rt.content).toBe('hello')
    expect(rt.timestamp).toBe(1700000000000)
  })

  it('round-trips step lifecycle events', () => {
    const started: SessionEvent = {
      type: 'step_started',
      sessionId: 's1',
      turnId: 't1',
      agentId: 'supervisor',
      timestamp: 1,
    }
    const ended: SessionEvent = {
      type: 'step_ended',
      sessionId: 's1',
      turnId: 't1',
      agentId: 'supervisor',
      timestamp: 2,
    }
    const rtStarted = JSON.parse(JSON.stringify(started)) as Extract<SessionEvent, { type: 'step_started' }>
    const rtEnded = JSON.parse(JSON.stringify(ended)) as Extract<SessionEvent, { type: 'step_ended' }>
    expect(rtStarted.type).toBe('step_started')
    expect(rtEnded.type).toBe('step_ended')
  })

  it('round-trips text lifecycle events', () => {
    const started: SessionEvent = {
      type: 'text_started',
      sessionId: 's1',
      messageId: 'm1',
      timestamp: 1,
    }
    const ended: SessionEvent = {
      type: 'text_ended',
      sessionId: 's1',
      messageId: 'm1',
      content: 'hi',
      timestamp: 2,
    }
    const rtStarted = JSON.parse(JSON.stringify(started)) as Extract<SessionEvent, { type: 'text_started' }>
    const rtEnded = JSON.parse(JSON.stringify(ended)) as Extract<SessionEvent, { type: 'text_ended' }>
    expect(rtStarted.type).toBe('text_started')
    expect(rtEnded.type).toBe('text_ended')
    expect(rtEnded.content).toBe('hi')
  })

  it('round-trips tool lifecycle events', () => {
    const called: SessionEvent = {
      type: 'tool_called',
      sessionId: 's1',
      callId: 'c1',
      name: 'read_file',
      input: '{}',
      timestamp: 1,
    }
    const success: SessionEvent = {
      type: 'tool_success',
      sessionId: 's1',
      callId: 'c1',
      output: 'ok',
      timestamp: 2,
    }
    const failed: SessionEvent = {
      type: 'tool_failed',
      sessionId: 's1',
      callId: 'c1',
      error: 'not found',
      timestamp: 3,
    }
    const rtCalled = JSON.parse(JSON.stringify(called)) as Extract<SessionEvent, { type: 'tool_called' }>
    const rtSuccess = JSON.parse(JSON.stringify(success)) as Extract<SessionEvent, { type: 'tool_success' }>
    const rtFailed = JSON.parse(JSON.stringify(failed)) as Extract<SessionEvent, { type: 'tool_failed' }>
    expect(rtCalled.type).toBe('tool_called')
    expect(rtSuccess.type).toBe('tool_success')
    expect(rtFailed.type).toBe('tool_failed')
  })

  it('round-trips compaction_ended event', () => {
    const e: SessionEvent = {
      type: 'compaction_ended',
      sessionId: 's1',
      summary: 'summary text',
      timestamp: 1,
      replacedMessageIds: ['a1', 'u2'],
    }
    const rt = JSON.parse(JSON.stringify(e)) as Extract<SessionEvent, { type: 'compaction_ended' }>
    expect(rt.type).toBe('compaction_ended')
    expect(rt.summary).toBe('summary text')
    expect(rt.replacedMessageIds).toEqual(['a1', 'u2'])
  })
})

// ──────────────────────────────────────────────────────────────────
// NetworkPolicyConfig contract
// ──────────────────────────────────────────────────────────────────

describe('protocol: NetworkPolicyConfig', () => {
  it('round-trips a full policy config', () => {
    const cfg: NetworkPolicyConfig = {
      allowlist: ['https://example.com'],
      denylist: ['https://evil.com'],
      maxRequestsPerMinute: 10,
      maxResponseBytes: 1024,
    }
    const rt = JSON.parse(JSON.stringify(cfg)) as NetworkPolicyConfig
    expect(rt.allowlist).toEqual(['https://example.com'])
    expect(rt.denylist).toEqual(['https://evil.com'])
    expect(rt.maxRequestsPerMinute).toBe(10)
    expect(rt.maxResponseBytes).toBe(1024)
  })

  it('allows all fields to be absent', () => {
    const cfg: NetworkPolicyConfig = {}
    expect(cfg.allowlist).toBeUndefined()
    expect(cfg.denylist).toBeUndefined()
    expect(cfg.maxRequestsPerMinute).toBeUndefined()
    expect(cfg.maxResponseBytes).toBeUndefined()
  })
})

// ──────────────────────────────────────────────────────────────────
// New ClientMessage variants
// ──────────────────────────────────────────────────────────────────

describe('protocol: input queue ClientMessage variants', () => {
  it('input:enqueue round-trips', () => {
    const m: ClientMessage = { type: 'input:enqueue', sessionId: 's', id: 'm1', content: 'hello' }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ClientMessage, { type: 'input:enqueue' }>
    expect(rt.type).toBe('input:enqueue')
    expect(rt.sessionId).toBe('s')
    expect(rt.id).toBe('m1')
    expect(rt.content).toBe('hello')
  })

  it('input:steer round-trips', () => {
    const m: ClientMessage = { type: 'input:steer', sessionId: 's', id: 'm1', content: 'go left' }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ClientMessage, { type: 'input:steer' }>
    expect(rt.type).toBe('input:steer')
    expect(rt.sessionId).toBe('s')
    expect(rt.id).toBe('m1')
    expect(rt.content).toBe('go left')
  })
})

describe('protocol: subagent background ClientMessage variant', () => {
  it('subagent:background round-trips', () => {
    const m: ClientMessage = {
      type: 'subagent:background',
      sessionId: 's',
      taskId: 't1',
      description: 'do background work',
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ClientMessage, { type: 'subagent:background' }>
    expect(rt.type).toBe('subagent:background')
    expect(rt.sessionId).toBe('s')
    expect(rt.taskId).toBe('t1')
    expect(rt.description).toBe('do background work')
  })
})

// ──────────────────────────────────────────────────────────────────
// ServerMessage variants
// ──────────────────────────────────────────────────────────────────

describe('protocol: agent:notification ServerMessage', () => {
  it('round-trips completed notification', () => {
    const m: ServerMessage = {
      type: 'agent:notification',
      sessionId: 's',
      taskId: 't1',
      description: 'done',
      status: 'completed',
      result: 'result text',
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ServerMessage, { type: 'agent:notification' }>
    expect(rt.type).toBe('agent:notification')
    expect(rt.status).toBe('completed')
    expect(rt.result).toBe('result text')
  })

  it('round-trips failed notification', () => {
    const m: ServerMessage = {
      type: 'agent:notification',
      sessionId: 's',
      taskId: 't1',
      description: 'failed',
      status: 'failed',
      error: 'boom',
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ServerMessage, { type: 'agent:notification' }>
    expect(rt.status).toBe('failed')
    expect(rt.error).toBe('boom')
    expect(rt.result).toBeUndefined()
  })
})

// ──────────────────────────────────────────────────────────────────
// HookEvent / HookResult extensions
// ──────────────────────────────────────────────────────────────────

describe('protocol: HookEvent + HookResult extensions', () => {
  it('admits the activity hook events', () => {
    const events: HookEvent[] = ['ActivityStart', 'ActivityEnd', 'ActivityBudgetRequest']
    expect(events).toEqual(['ActivityStart', 'ActivityEnd', 'ActivityBudgetRequest'])
  })

  it('HookResult carries optional steps for ActivityBudgetRequest', () => {
    const r: HookResult = { kind: 'allow', steps: 5 }
    expect(r.steps).toBe(5)
  })
})

// ──────────────────────────────────────────────────────────────────
// SessionConfig.useEventSource
// ──────────────────────────────────────────────────────────────────

describe('protocol: SessionConfig.useEventSource', () => {
  it('round-trips useEventSource flag', () => {
    const cfg: SessionConfig = {
      llmProvider: 'deepseek',
      model: 'deepseek-chat',
      tools: [],
      useEventSource: true,
    }
    const rt = JSON.parse(JSON.stringify(cfg)) as SessionConfig
    expect(rt.useEventSource).toBe(true)
  })

  it('useEventSource is optional', () => {
    const cfg: SessionConfig = {
      llmProvider: 'deepseek',
      model: 'deepseek-chat',
      tools: [],
    }
    expect(cfg.useEventSource).toBeUndefined()
  })
})
