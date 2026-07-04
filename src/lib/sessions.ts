import type { SessionConfig } from '@hip/protocol'

/** The surface a session belongs to. The sidecar stamps `config.surface`; a missing value
 *  (only a transient/edge case) is treated as 'code', the fuller surface. */
export function surfaceOf(config: Pick<SessionConfig, 'surface'>): 'chat' | 'code' {
  return config.surface === 'chat' || config.surface === 'code' ? config.surface : 'code'
}
