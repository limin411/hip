// src/ipc/catalog.ts
import { invoke } from '@tauri-apps/api/core'

/** One entry from models.dev `reasoning_options` (effort list, toggle, or budget). */
export type ReasoningOption =
  | { type: 'effort'; values: string[] }
  | { type: 'toggle' }
  | { type: 'budget_tokens'; min?: number; max?: number }
  | { type: string; values?: string[]; min?: number; max?: number }

export interface CatalogModel {
  id: string
  name: string
  family?: string
  reasoning?: boolean
  /** Provider-advertised reasoning controls; effort levels live here when type is `effort`. */
  reasoning_options?: ReasoningOption[]
  tool_call?: boolean
  attachment?: boolean
  /** USD per 1e6 tokens; models.dev may include cache_read / cache_write. */
  cost?: {
    input: number
    output: number
    cache_read?: number
    cache_write?: number
  }
  limit?: { context: number; output: number }
}
export interface CatalogProvider {
  id: string
  name: string
  env: string[]
  npm?: string
  api?: string
  models: Record<string, CatalogModel>
  custom?: boolean          // set true by us for user-defined providers (never from models.dev)
}
export type Catalog = Record<string, CatalogProvider>

/** Providers reachable via @ai-sdk/openai semantics even when models.dev tags a different npm. */
const COMPATIBLE_IDS = new Set([
  'deepseek', 'openai', 'openrouter', 'groq', 'moonshotai', 'zhipuai', 'siliconflow',
  'mistral', 'xai', 'togetherai', 'deepinfra', 'fireworks', 'perplexity', 'ollama', 'lmstudio',
  'anthropic',
])

export function isCompatible(p: CatalogProvider): boolean {
  if (p.custom) return true
  if (p.npm === '@ai-sdk/openai' || p.npm === '@ai-sdk/openai-compatible' || p.npm === '@ai-sdk/anthropic') return true
  return COMPATIBLE_IDS.has(p.id)
}

/** Local catalog only (disk cache or bundled snapshot). Never blocks on network. */
export async function fetchCatalog(): Promise<Catalog> {
  const raw = await invoke<string>('models_catalog')
  return JSON.parse(raw) as Catalog
}

/**
 * Force-fetch models.dev (or HIP_MODELS_URL), rewrite ~/.hip/cache/models.json, return fresh catalog.
 * Used for stale-while-revalidate after boot; keep serving the previous catalog on failure.
 */
export async function refreshCatalog(): Promise<Catalog> {
  const raw = await invoke<string>('models_catalog_refresh')
  return JSON.parse(raw) as Catalog
}
