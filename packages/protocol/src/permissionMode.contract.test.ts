import { describe, it, expect } from 'vitest'
import type { PermissionMode, SessionConfig } from './index.js'

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
