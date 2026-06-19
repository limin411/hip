export type {
  HookEvent,
  HookResult,
  HookMatcher,
  Hook,
  HookContext,
} from '@hip/protocol'

import type { HookContext, HookResult } from '@hip/protocol'

export type HookHandler = (ctx: HookContext) => Promise<HookResult>
