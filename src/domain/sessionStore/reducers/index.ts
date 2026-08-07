// src/domain/sessionStore/reducers/index.ts
// applyServerMessage dispatcher (spec 2026-08-07-session-store-decomposition-spec):
// every message type belongs to exactly one domain reducer — flow/plan/misc via
// whitelist Set, session:* via prefix. Unknown types fall through to misc's
// default → state unchanged (matches the original single-switch default).
import type { ServerMessage } from '@hip/protocol'
import { flowReducer } from './flow'
import { sessionReducer } from './session'
import { planReducer } from './plan'
import { miscReducer } from './misc'
import type { SessionState } from './helpers'

const FLOW_TYPES = new Set<string>([
  'agent:started',
  'token:stream',
  'reasoning:delta',
  'agent:finished',
  'tool:started',
  'tool:finished',
  'message:complete',
  'agent:interrupt',
  'agent:configOptions',
  'agent:profiles',
  'agent:interrupt:resolved',
  'error',
  'agent:notification',
  'task:notification',
])

const PLAN_TYPES = new Set<string>([
  'plan:delta',
  'plan:updated',
  'plan:published',
  'plan:respond:result',
  'permission:request',
  'permission:resolved',
])

/** 把一条 ServerMessage 归并进状态。纯函数：now 由调用方注入。 */
export function applyServerMessage(
  state: SessionState,
  msg: ServerMessage,
  now: number,
): SessionState {
  if (FLOW_TYPES.has(msg.type)) return flowReducer(state, msg, now)
  if (PLAN_TYPES.has(msg.type)) return planReducer(state, msg, now)
  if (msg.type.startsWith('session:')) return sessionReducer(state, msg, now)
  return miscReducer(state, msg, now)
}
