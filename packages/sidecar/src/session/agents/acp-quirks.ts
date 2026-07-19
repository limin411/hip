export interface AcpQuirks {
  /** Agent returns stopReason 'end_turn' (not 'cancelled') on a genuine cancel — rely on our own abort flag. */
  cancelReportsEndTurn: boolean
  /** Agent's default model is billed/hosted — Mode A must set an explicit model. */
  defaultModelIsBilled: boolean
}

const DEFAULTS: AcpQuirks = { cancelReportsEndTurn: false, defaultModelIsBilled: false }

// OpenCode needs non-default quirks. grok-build/pi/claude-code/codex run on DEFAULTS today
// (quirksFor returns DEFAULTS for any key without a profile) — add a profile here only when real
// testing shows one is needed. defaultModelIsBilled is vestigial post model-rollback;
// cancelReportsEndTurn is the only quirk consumed at runtime (provider always trusts local abort flag).
const PROFILES: Record<string, Partial<AcpQuirks>> = {
  opencode: { cancelReportsEndTurn: true, defaultModelIsBilled: true },
}

export function quirksFor(key: string | undefined): AcpQuirks {
  return { ...DEFAULTS, ...(key ? PROFILES[key] ?? {} : {}) }
}
