import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'

export interface CatalogModel {
  id: string
  name: string
  attachment?: boolean
  reasoning?: boolean
  reasoning_options?: Array<{ type?: string; values?: string[] }>
  /** Provider-advertised token limits (models.dev / cache). */
  limit?: { context?: number; output?: number }
}

export interface CatalogProvider {
  id: string
  name: string
  models: Record<string, CatalogModel>
  /** models.dev npm package tag (e.g. @ai-sdk/anthropic, @ai-sdk/openai-compatible). */
  npm?: string
  /** Default OpenAI-/Anthropic-style API base URL from models.dev. */
  api?: string
}

export type Catalog = Record<string, CatalogProvider>

let cached: Catalog | null = null
let cachedMtimeMs = 0

function cachePath(): string {
  return path.join(homedir(), '.hip', 'cache', 'models.json')
}

/** Best-effort read of the renderer's cached models.json. Falls back to an empty catalog. */
export function readCatalog(): Catalog {
  try {
    const p = cachePath()
    const stat = fs.statSync(p)
    if (!stat.isFile()) return {}
    if (cached && stat.mtimeMs === cachedMtimeMs) return cached
    const raw = fs.readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw) as Catalog
    cached = parsed
    cachedMtimeMs = stat.mtimeMs
    return parsed
  } catch {
    cached = null
    cachedMtimeMs = 0
    return {}
  }
}

export function isMultimodalModel(providerID: string, modelID: string): boolean {
  return !!readCatalog()[providerID]?.models[modelID]?.attachment
}

/** Effort values advertised on a catalog model entry, or null when none. */
export function effortLevelsFromCatalogModel(model: CatalogModel | undefined | null): string[] | null {
  if (!model) return null
  const values: string[] = []
  for (const opt of model.reasoning_options ?? []) {
    if (opt?.type !== 'effort' || !Array.isArray(opt.values)) continue
    for (const v of opt.values) {
      if (typeof v === 'string' && v.trim() && !values.includes(v)) values.push(v)
    }
  }
  return values.length > 0 ? values : null
}

/**
 * Filter SessionConfig.effort against a concrete catalog model entry.
 * - Model unknown (`undefined`) → pass through (custom / catalog not loaded).
 * - Model known with no effort options → drop.
 * - Model known with a list → keep only if listed (else drop).
 */
export function clampEffortAgainstModel(
  model: CatalogModel | undefined | null,
  effort: string | undefined,
): string | undefined {
  if (!effort) return undefined
  if (!model) return effort
  const levels = effortLevelsFromCatalogModel(model)
  if (!levels) return undefined
  return levels.includes(effort) ? effort : undefined
}

/** Effort values for a provider/model id from the on-disk catalog. */
export function effortLevelsForModel(providerID: string, modelID: string): string[] | null {
  return effortLevelsFromCatalogModel(readCatalog()[providerID]?.models?.[modelID])
}

/**
 * Filter SessionConfig.effort for the concrete model before building the chat client.
 * Uses the renderer's cached models.json when available.
 */
export function clampEffortForModel(
  providerID: string,
  modelID: string,
  effort: string | undefined,
): string | undefined {
  return clampEffortAgainstModel(readCatalog()[providerID]?.models?.[modelID], effort)
}
