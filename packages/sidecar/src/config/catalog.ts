import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'

export interface CatalogModel {
  id: string
  name: string
  attachment?: boolean
}

export interface CatalogProvider {
  id: string
  name: string
  models: Record<string, CatalogModel>
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
