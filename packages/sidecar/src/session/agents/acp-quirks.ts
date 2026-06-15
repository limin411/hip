export interface AcpQuirks {
  /** Agent returns stopReason 'end_turn' (not 'cancelled') on a genuine cancel — rely on our own abort flag. */
  cancelReportsEndTurn: boolean
  /** Agent's default model is billed/hosted — Mode A must set an explicit model. */
  defaultModelIsBilled: boolean
}

const DEFAULTS: AcpQuirks = { cancelReportsEndTurn: false, defaultModelIsBilled: false }

const PROFILES: Record<string, Partial<AcpQuirks>> = {
  opencode: { cancelReportsEndTurn: true, defaultModelIsBilled: true },
}

export function quirksFor(key: string | undefined): AcpQuirks {
  return { ...DEFAULTS, ...(key ? PROFILES[key] ?? {} : {}) }
}
