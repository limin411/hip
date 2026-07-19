import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { MEMORY_FILE_CONFIG_DEFAULTS, type MemoryFileConfig } from '@hip/protocol'

/**
 * Path to `memory.json`.
 * Precedence: explicit override → `HIP_MEMORY_CONFIG_PATH` →
 * `$HIP_DATA_DIR/config/memory.json` (E2E isolation) → `~/.hip/config/memory.json`.
 */
export function memoryConfigPath(override?: string): string {
  if (override?.trim()) return override.trim()
  const fromEnv = process.env.HIP_MEMORY_CONFIG_PATH?.trim()
  if (fromEnv) return fromEnv
  const dataDir = process.env.HIP_DATA_DIR?.trim()
  if (dataDir) return join(dataDir, 'config', 'memory.json')
  return join(homedir(), '.hip', 'config', 'memory.json')
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Merge a partial onto defaults. Forces version 1. Missing keys keep defaults. */
export function mergeMemoryConfig(partial: Partial<MemoryFileConfig> | Record<string, unknown> = {}): MemoryFileConfig {
  if (!isObject(partial)) return { ...MEMORY_FILE_CONFIG_DEFAULTS }
  const out: MemoryFileConfig = { ...MEMORY_FILE_CONFIG_DEFAULTS }
  for (const [k, v] of Object.entries(partial)) {
    if (k === 'version' || v === undefined) continue
    // Explicit clear of optional fields (null / empty string) → leave defaults / absent.
    if (v === null || v === '') continue
    if (k in MEMORY_FILE_CONFIG_DEFAULTS || isOptionalMemoryKey(k)) {
      ;(out as unknown as Record<string, unknown>)[k] = v
    }
  }
  out.version = 1
  return out
}

function isOptionalMemoryKey(k: string): boolean {
  return [
    'minUserTurns',
    'minUserChars',
    'minExtractIntervalHours',
    'decayFactor',
    'forgetConfidence',
    'extractModel',
    'extractMaxTokens',
    'onboardingTipDismissed',
    'simpleExtract',
    'embeddingModel',
    'rerankModel',
    'hybridSearchEnabled',
    'maxExtractsPerDay',
    'trashRetentionDays',
    'coreInjectionMode',
    'coreMaxItems',
    'coreItemBodyChars',
    'maxActiveItems',
    'maxActiveItemChars',
    'throttleOnEmptyExtract',
    'importMirrorIfDbEmpty',
    'requireWriteConfirmation',
    'memoryToolsForSubagents',
    'useMemoriesWithExternal',
    'perAgentMemory',
    'backend',
  ].includes(k)
}

/** Load memory.json; missing/invalid → defaults (+ warn on invalid). */
export function loadMemoryConfig(configPath?: string): MemoryFileConfig {
  const path = memoryConfigPath(configPath)
  if (!existsSync(path)) return { ...MEMORY_FILE_CONFIG_DEFAULTS }
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isObject(parsed)) {
      console.warn(`[memory-config] invalid JSON shape at ${path}; using defaults`)
      return { ...MEMORY_FILE_CONFIG_DEFAULTS }
    }
    return mergeMemoryConfig(parsed)
  } catch (err) {
    console.warn(
      `[memory-config] failed to load ${path}:`,
      err instanceof Error ? err.message : String(err),
    )
    return { ...MEMORY_FILE_CONFIG_DEFAULTS }
  }
}

/** Load, merge partial, write JSON with mode 0o600. Returns merged config. */
export function saveMemoryConfig(
  partial: Partial<MemoryFileConfig>,
  configPath?: string,
): MemoryFileConfig {
  const path = memoryConfigPath(configPath)
  const current = loadMemoryConfig(path)
  const merged = mergeMemoryConfig({ ...current, ...partial })
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // best-effort; some platforms ignore mode on existing files
  }
  return merged
}

export type SessionMemoryFlagsInput = {
  useMemories?: boolean
  generateMemories?: boolean
  incognito?: boolean
}

export type ResolvedSessionMemoryFlags = {
  use: boolean
  generate: boolean
  incognito: boolean
}

/**
 * Priority: incognito forces both off → session explicit fields → global memory.json.
 */
export function resolveSessionMemoryFlags(
  global: MemoryFileConfig,
  session: SessionMemoryFlagsInput,
): ResolvedSessionMemoryFlags {
  if (session.incognito === true) {
    return { use: false, generate: false, incognito: true }
  }
  return {
    incognito: false,
    use: session.useMemories ?? global.useMemories,
    generate: session.generateMemories ?? global.generateMemories,
  }
}
