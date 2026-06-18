import type { SessionConfig } from '@hip/protocol'
import { isScratchCwd } from './scratch.js'

/** Resolve a session's surface: the explicit field wins; legacy rows infer from a scratch cwd
 *  (the pure-chat sandbox ⇒ 'chat', any other/absent cwd ⇒ 'code'). The `root` arg is for tests. */
export function surfaceOf(
  config: Pick<SessionConfig, 'surface' | 'cwd'>,
  sessionId: string,
  root?: string,
): 'chat' | 'code' {
  if (config.surface === 'chat' || config.surface === 'code') return config.surface
  return isScratchCwd(config.cwd, sessionId, root) ? 'chat' : 'code'
}
