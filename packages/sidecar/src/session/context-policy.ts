/**
 * Resolve effective context/compaction policy from hip.toml `[context]` + env.
 */
import type { ContextConfig, ContextGateMode } from '@hip/protocol'
import { isContextGateMode, parseContextGateMode } from '@hip/protocol'
import {
  AUTO_COMPACT_THRESHOLD_PERCENT,
  SUBAGENT_COMPACT_THRESHOLD_PERCENT,
  TARGET_THRESHOLD_PERCENT,
} from './context-budget.js'

/** Keep aligned with prefire.PREFIRE_LEAD_PERCENT (avoid circular import). */
const DEFAULT_PREFIRE_LEAD_PERCENT = 10
const DEFAULT_TOOL_OUTPUT_MAX_BYTES = 40 * 1024
const DEFAULT_OUTPUT_BUFFER_TOKENS = 0
const DEFAULT_GATE_MODE: ContextGateMode = 'percent'
const DEFAULT_HYBRID_FILL = true
const DEFAULT_COST_CACHE_READ_MULT = 0.1
const DEFAULT_COST_CACHE_WRITE_MULT = 1.25

export interface ResolvedContextPolicy {
  autoCompactPercent: number
  subagentCompactPercent: number
  targetKeepPercent: number
  prefireLeadPercent: number
  twoPass: boolean
  memoryFlushBeforeCompact: boolean
  toolOutputMaxBytes: number
  /**
   * Absolute headroom tokens. Default 0 (KD-3).
   * Stored for later compact wiring via `exceedsGate`; product compact still
   * uses percent-of-window only (`exceedsThreshold`) until that PR.
   */
  outputBufferTokens: number
  /**
   * percent | usable | percent_minus_buffer. Default percent.
   * Stored for later compact wiring; compact still uses `exceedsThreshold`
   * (percent path). hip.toml / env `gateMode` is inert until then.
   */
  gateMode: ContextGateMode
  /**
   * Hybrid mid-turn pressure. Default true (KD-19).
   * Kill switch: HIP_CONTEXT_HYBRID_FILL=0. Applied in compact/prefire gates.
   */
  hybridFill: boolean
  costCacheReadMultiplier: number
  costCacheWriteMultiplier: number
  /** Optional soft-prune protect window (later PR; undefined = use code default). */
  pruneProtectTokens?: number
  /** Optional soft-prune minimum release (later PR). */
  pruneMinimumTokens?: number
}

export const DEFAULT_CONTEXT_POLICY: ResolvedContextPolicy = {
  autoCompactPercent: AUTO_COMPACT_THRESHOLD_PERCENT,
  subagentCompactPercent: SUBAGENT_COMPACT_THRESHOLD_PERCENT,
  targetKeepPercent: TARGET_THRESHOLD_PERCENT,
  prefireLeadPercent: DEFAULT_PREFIRE_LEAD_PERCENT,
  twoPass: true,
  memoryFlushBeforeCompact: true,
  toolOutputMaxBytes: DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  outputBufferTokens: DEFAULT_OUTPUT_BUFFER_TOKENS,
  gateMode: DEFAULT_GATE_MODE,
  hybridFill: DEFAULT_HYBRID_FILL,
  costCacheReadMultiplier: DEFAULT_COST_CACHE_READ_MULT,
  costCacheWriteMultiplier: DEFAULT_COST_CACHE_WRITE_MULT,
}

function clampPercent(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback
  return Math.max(1, Math.min(100, Math.round(n)))
}

function envBool(name: string): boolean | undefined {
  const v = process.env[name]
  if (v === undefined) return undefined
  if (v === '0' || v === 'false' || v === 'off') return false
  if (v === '1' || v === 'true' || v === 'on') return true
  return undefined
}

function envInt(name: string): number | undefined {
  const v = process.env[name]
  if (v === undefined || v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function envFloat(name: string): number | undefined {
  const v = process.env[name]
  if (v === undefined || v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function envGateMode(name: string): ContextGateMode | undefined {
  const v = process.env[name]
  if (v === undefined || v.trim() === '') return undefined
  return parseContextGateMode(v)
}

/**
 * Merge hip.toml `[context]` with env overrides.
 *
 * Env (highest wins when set):
 * - HIP_TWO_PASS_COMPACT
 * - HIP_CONTEXT_AUTO_COMPACT_PERCENT
 * - HIP_CONTEXT_SUBAGENT_COMPACT_PERCENT
 * - HIP_CONTEXT_TARGET_KEEP_PERCENT
 * - HIP_CONTEXT_PREFIRE_LEAD_PERCENT
 * - HIP_CONTEXT_MEMORY_FLUSH
 * - HIP_TOOL_OUTPUT_MAX_BYTES
 * - HIP_CONTEXT_OUTPUT_BUFFER_TOKENS
 * - HIP_CONTEXT_GATE_MODE
 * - HIP_CONTEXT_HYBRID_FILL
 * - HIP_CONTEXT_COST_CACHE_READ_MULT
 * - HIP_CONTEXT_COST_CACHE_WRITE_MULT
 * - HIP_CONTEXT_PRUNE_PROTECT_TOKENS
 * - HIP_CONTEXT_PRUNE_MINIMUM_TOKENS
 */
export function resolveContextPolicy(partial?: ContextConfig | null): ResolvedContextPolicy {
  const base: ResolvedContextPolicy = { ...DEFAULT_CONTEXT_POLICY }
  if (partial) {
    if (partial.autoCompactPercent != null) {
      base.autoCompactPercent = clampPercent(partial.autoCompactPercent, base.autoCompactPercent)
    }
    if (partial.subagentCompactPercent != null) {
      base.subagentCompactPercent = clampPercent(
        partial.subagentCompactPercent,
        base.subagentCompactPercent,
      )
    }
    if (partial.targetKeepPercent != null) {
      base.targetKeepPercent = clampPercent(partial.targetKeepPercent, base.targetKeepPercent)
    }
    if (partial.prefireLeadPercent != null) {
      base.prefireLeadPercent = clampPercent(partial.prefireLeadPercent, base.prefireLeadPercent)
    }
    if (typeof partial.twoPass === 'boolean') base.twoPass = partial.twoPass
    if (typeof partial.memoryFlushBeforeCompact === 'boolean') {
      base.memoryFlushBeforeCompact = partial.memoryFlushBeforeCompact
    }
    if (
      typeof partial.toolOutputMaxBytes === 'number' &&
      Number.isFinite(partial.toolOutputMaxBytes) &&
      partial.toolOutputMaxBytes > 0
    ) {
      base.toolOutputMaxBytes = Math.floor(partial.toolOutputMaxBytes)
    }
    if (
      typeof partial.outputBufferTokens === 'number' &&
      Number.isFinite(partial.outputBufferTokens) &&
      partial.outputBufferTokens >= 0
    ) {
      base.outputBufferTokens = Math.floor(partial.outputBufferTokens)
    }
    if (isContextGateMode(partial.gateMode)) {
      base.gateMode = partial.gateMode
    }
    if (typeof partial.hybridFill === 'boolean') base.hybridFill = partial.hybridFill
    if (
      typeof partial.costCacheReadMultiplier === 'number' &&
      Number.isFinite(partial.costCacheReadMultiplier) &&
      partial.costCacheReadMultiplier >= 0
    ) {
      base.costCacheReadMultiplier = partial.costCacheReadMultiplier
    }
    if (
      typeof partial.costCacheWriteMultiplier === 'number' &&
      Number.isFinite(partial.costCacheWriteMultiplier) &&
      partial.costCacheWriteMultiplier >= 0
    ) {
      base.costCacheWriteMultiplier = partial.costCacheWriteMultiplier
    }
    if (
      typeof partial.pruneProtectTokens === 'number' &&
      Number.isFinite(partial.pruneProtectTokens) &&
      partial.pruneProtectTokens > 0
    ) {
      base.pruneProtectTokens = Math.floor(partial.pruneProtectTokens)
    }
    if (
      typeof partial.pruneMinimumTokens === 'number' &&
      Number.isFinite(partial.pruneMinimumTokens) &&
      partial.pruneMinimumTokens > 0
    ) {
      base.pruneMinimumTokens = Math.floor(partial.pruneMinimumTokens)
    }
  }

  const twoPassEnv = envBool('HIP_TWO_PASS_COMPACT')
  if (twoPassEnv !== undefined) base.twoPass = twoPassEnv

  const autoEnv = envInt('HIP_CONTEXT_AUTO_COMPACT_PERCENT')
  if (autoEnv !== undefined) base.autoCompactPercent = clampPercent(autoEnv, base.autoCompactPercent)

  const subEnv = envInt('HIP_CONTEXT_SUBAGENT_COMPACT_PERCENT')
  if (subEnv !== undefined) {
    base.subagentCompactPercent = clampPercent(subEnv, base.subagentCompactPercent)
  }

  const keepEnv = envInt('HIP_CONTEXT_TARGET_KEEP_PERCENT')
  if (keepEnv !== undefined) base.targetKeepPercent = clampPercent(keepEnv, base.targetKeepPercent)

  const leadEnv = envInt('HIP_CONTEXT_PREFIRE_LEAD_PERCENT')
  if (leadEnv !== undefined) base.prefireLeadPercent = clampPercent(leadEnv, base.prefireLeadPercent)

  const flushEnv = envBool('HIP_CONTEXT_MEMORY_FLUSH')
  if (flushEnv !== undefined) base.memoryFlushBeforeCompact = flushEnv

  const toolEnv = envInt('HIP_TOOL_OUTPUT_MAX_BYTES')
  if (toolEnv !== undefined && toolEnv > 0) base.toolOutputMaxBytes = Math.floor(toolEnv)

  const bufferEnv = envInt('HIP_CONTEXT_OUTPUT_BUFFER_TOKENS')
  if (bufferEnv !== undefined && bufferEnv >= 0) {
    base.outputBufferTokens = Math.floor(bufferEnv)
  }

  const gateEnv = envGateMode('HIP_CONTEXT_GATE_MODE')
  if (gateEnv !== undefined) base.gateMode = gateEnv

  const hybridEnv = envBool('HIP_CONTEXT_HYBRID_FILL')
  if (hybridEnv !== undefined) base.hybridFill = hybridEnv

  const readMultEnv = envFloat('HIP_CONTEXT_COST_CACHE_READ_MULT')
  if (readMultEnv !== undefined && readMultEnv >= 0) {
    base.costCacheReadMultiplier = readMultEnv
  }

  const writeMultEnv = envFloat('HIP_CONTEXT_COST_CACHE_WRITE_MULT')
  if (writeMultEnv !== undefined && writeMultEnv >= 0) {
    base.costCacheWriteMultiplier = writeMultEnv
  }

  const pruneProtectEnv = envInt('HIP_CONTEXT_PRUNE_PROTECT_TOKENS')
  if (pruneProtectEnv !== undefined && pruneProtectEnv > 0) {
    base.pruneProtectTokens = Math.floor(pruneProtectEnv)
  }

  const pruneMinEnv = envInt('HIP_CONTEXT_PRUNE_MINIMUM_TOKENS')
  if (pruneMinEnv !== undefined && pruneMinEnv > 0) {
    base.pruneMinimumTokens = Math.floor(pruneMinEnv)
  }

  return base
}
