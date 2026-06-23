// src/ipc/catalog.ts
import { invoke } from '@tauri-apps/api/core'

export interface CatalogModel {
  id: string
  name: string
  family?: string
  reasoning?: boolean
  tool_call?: boolean
  attachment?: boolean
  cost?: { input: number; output: number }
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

export async function fetchCatalog(): Promise<Catalog> {
  const raw = await invoke<string>('models_catalog')
  return JSON.parse(raw) as Catalog
}
