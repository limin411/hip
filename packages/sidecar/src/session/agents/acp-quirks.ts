export interface AcpQuirks {
  /** Agent returns stopReason 'end_turn' (not 'cancelled') on a genuine cancel — rely on our own abort flag. */
  cancelReportsEndTurn: boolean
  /** Agent's default model is billed/hosted — Mode A must set an explicit model. */
  defaultModelIsBilled: boolean
}

const DEFAULTS: AcpQuirks = { cancelReportsEndTurn: false, defaultModelIsBilled: false }

// Reserve point — future ACP providers (claude-code, codex, kimi-code) add their quirk profile here.
// Today only OpenCode is selectable in the provider picker (src/lib/acpPresets.ts); the others are
// 'coming-soon' placeholders, so no unimplemented profile can be reached at runtime.
const PROFILES: Record<string, Partial<AcpQuirks>> = {
  opencode: { cancelReportsEndTurn: true, defaultModelIsBilled: true },
}

export function quirksFor(key: string | undefined): AcpQuirks {
  return { ...DEFAULTS, ...(key ? PROFILES[key] ?? {} : {}) }
}
