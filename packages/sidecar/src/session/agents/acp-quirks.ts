export interface AcpQuirks {
  /** Agent returns stopReason 'end_turn' (not 'cancelled') on a genuine cancel — rely on our own abort flag. */
  cancelReportsEndTurn: boolean
  /** Agent's default model is billed/hosted — Mode A must set an explicit model. */
  defaultModelIsBilled: boolean
  /**
   * After session/set_config_option fails for model|mode, whether to try session/set_model + session/set_mode.
   * DEFAULT 'set_model_mode' preserves today's connection catch-all (Grok Build and similar).
   * Set 'none' only when an agent must not attempt that fallback.
   */
  setConfigOptionFallback: 'none' | 'set_model_mode'
}

const DEFAULTS: AcpQuirks = {
  cancelReportsEndTurn: false,
  defaultModelIsBilled: false,
  setConfigOptionFallback: 'set_model_mode', // keep catch-all for all agents unless profile tightens
}

// OpenCode needs non-default quirks. grok-build/pi/claude-code/codex run on DEFAULTS today
// (quirksFor returns DEFAULTS for any key without a profile) — add a profile here only when real
// testing shows one is needed. defaultModelIsBilled is vestigial post model-rollback;
// cancelReportsEndTurn + setConfigOptionFallback are consumed at runtime.
const PROFILES: Record<string, Partial<AcpQuirks>> = {
  opencode: { cancelReportsEndTurn: true, defaultModelIsBilled: true },
  // grok-build: inherits DEFAULT set_model_mode (no profile needed)
}

export function quirksFor(key: string | undefined): AcpQuirks {
  return { ...DEFAULTS, ...(key ? PROFILES[key] ?? {} : {}) }
}
