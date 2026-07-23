/**
 * Resolve effective context/compaction policy from hip.toml `[context]` + env.
 */
import type { ContextConfig } from '@hip/protocol'
import {
  AUTO_COMPACT_THRESHOLD_PERCENT,
  SUBAGENT_COMPACT_THRESHOLD_PERCENT,
  TARGET_THRESHOLD_PERCENT,
} from './context-budget.js'

/** Keep aligned with prefire.PREFIRE_LEAD_PERCENT (avoid circular import). */
const DEFAULT_PREFIRE_LEAD_PERCENT = 10
const DEFAULT_TOOL_OUTPUT_MAX_BYTES = 40 * 1024

export interface ResolvedContextPolicy {
  autoCompactPercent: number
  subagentCompactPercent: number
  targetKeepPercent: number
  prefireLeadPercent: number
  twoPass: boolean
  memoryFlushBeforeCompact: boolean
  toolOutputMaxBytes: number
}

export const DEFAULT_CONTEXT_POLICY: ResolvedContextPolicy = {
  autoCompactPercent: AUTO_COMPACT_THRESHOLD_PERCENT,
  subagentCompactPercent: SUBAGENT_COMPACT_THRESHOLD_PERCENT,
  targetKeepPercent: TARGET_THRESHOLD_PERCENT,
  prefireLeadPercent: DEFAULT_PREFIRE_LEAD_PERCENT,
  twoPass: true,
  memoryFlushBeforeCompact: true,
  toolOutputMaxBytes: DEFAULT_TOOL_OUTPUT_MAX_BYTES,
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

  return base
}
