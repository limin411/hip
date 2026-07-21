/**
 * Deterministic model-config review for marketplace plugin installs.
 * Rewrites unavailable AgentConfig.boundModel to the product default (activeModel).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import type {
  PluginModelReviewSummary,
  PluginModelReviewFinding,
  BoundModel,
  ActiveModel,
} from '@hip/protocol'
import { getActiveModel } from '../config/providers.js'
import { readHipConfig } from '../config/hip-config.js'

export interface ModelAvailability {
  /** providerID → enabled */
  providers: Record<string, boolean>
  /** Optional known model ids per provider (empty set ⇒ only check provider enabled) */
  modelsByProvider: Record<string, Set<string>>
}

export function loadModelAvailability(): ModelAvailability {
  const cfg = readHipConfig()
  const providers: Record<string, boolean> = {}
  const modelsByProvider: Record<string, Set<string>> = {}
  for (const p of cfg.providers ?? []) {
    if (p.id) providers[p.id] = p.enabled !== false
  }
  // Always treat active provider as present
  const active = getActiveModel()
  if (active.providerID && providers[active.providerID] === undefined) {
    providers[active.providerID] = true
  }
  return { providers, modelsByProvider }
}

export function isBoundModelAvailable(
  bound: BoundModel,
  availability: ModelAvailability,
): boolean {
  if (!bound.providerID || !bound.modelID) return false
  const enabled = availability.providers[bound.providerID]
  if (enabled === false) return false
  if (enabled === undefined) return false
  const known = availability.modelsByProvider[bound.providerID]
  if (known && known.size > 0 && !known.has(bound.modelID)) return false
  return true
}

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function resolveAgentsPaths(pluginDir: string): string[] {
  const manifestPath = join(pluginDir, '.plugin', 'plugin.json')
  const raw = readJson(manifestPath) as Record<string, unknown> | null
  if (!raw) return []

  const agents = raw.agents
  const paths: string[] = []
  if (typeof agents === 'string') {
    const p = agents.startsWith('./')
      ? join(pluginDir, agents.slice(2))
      : isAbsolute(agents)
        ? agents
        : join(pluginDir, agents)
    if (existsSync(p)) paths.push(p)
  }
  // Also scan common agents.json
  for (const rel of ['agents.json', 'agents/agents.json']) {
    const p = join(pluginDir, rel)
    if (existsSync(p) && !paths.includes(p)) paths.push(p)
  }
  return paths
}

function extractAgentsArray(raw: unknown): { agents: Record<string, unknown>[]; wrapper: 'array' | 'object' | null } {
  if (Array.isArray(raw)) {
    return {
      agents: raw.filter((a) => a && typeof a === 'object') as Record<string, unknown>[],
      wrapper: 'array',
    }
  }
  if (raw && typeof raw === 'object') {
    const arr = (raw as { agents?: unknown }).agents
    if (Array.isArray(arr)) {
      return {
        agents: arr.filter((a) => a && typeof a === 'object') as Record<string, unknown>[],
        wrapper: 'object',
      }
    }
  }
  return { agents: [], wrapper: null }
}

function parseBound(raw: unknown): BoundModel | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const providerID =
    typeof o.providerID === 'string'
      ? o.providerID
      : typeof o.providerId === 'string'
        ? o.providerId
        : undefined
  const modelID =
    typeof o.modelID === 'string'
      ? o.modelID
      : typeof o.modelId === 'string'
        ? o.modelId
        : undefined
  if (!providerID || !modelID) return null
  return { providerID, modelID }
}

/**
 * Review and rewrite plugin agent boundModel fields.
 * Returns summary; mutates agent JSON files on disk when rewriting.
 */
export function reviewPluginModels(
  pluginDir: string,
  opts?: {
    activeModel?: ActiveModel
    availability?: ModelAvailability
  },
): PluginModelReviewSummary {
  const active = opts?.activeModel ?? getActiveModel()
  const availability = opts?.availability ?? loadModelAvailability()
  const defaultModel = { providerID: active.providerID, modelID: active.modelID }
  const findings: PluginModelReviewFinding[] = []
  const reviewedAt = new Date().toISOString()

  if (!defaultModel.providerID || !defaultModel.modelID) {
    return {
      status: 'failed',
      defaultModel,
      findings: [
        {
          path: 'activeModel',
          action: 'error',
          message: 'No product default model configured',
        },
      ],
      reviewedAt,
    }
  }

  // Inline agents in plugin.json
  const manifestPath = join(pluginDir, '.plugin', 'plugin.json')
  if (existsSync(manifestPath)) {
    const manifest = readJson(manifestPath) as Record<string, unknown> | null
    if (manifest && Array.isArray(manifest.agents)) {
      let changed = false
      const agents = manifest.agents as Record<string, unknown>[]
      agents.forEach((agent, i) => {
        const bound = parseBound(agent.boundModel)
        if (!bound) return
        const path = `plugin.json agents[${i}].boundModel`
        if (isBoundModelAvailable(bound, availability)) {
          findings.push({
            path,
            original: bound,
            action: 'keep',
          })
        } else {
          agent.boundModel = { ...defaultModel }
          changed = true
          findings.push({
            path,
            original: bound,
            action: 'rewrite_to_default',
            message: `Rewrote to ${defaultModel.providerID}/${defaultModel.modelID}`,
          })
        }
      })
      if (changed) writeJson(manifestPath, manifest)
    }
  }

  // External agents files
  for (const agentsPath of resolveAgentsPaths(pluginDir)) {
    if (agentsPath.endsWith('plugin.json')) continue
    const raw = readJson(agentsPath)
    const { agents, wrapper } = extractAgentsArray(raw)
    if (!wrapper || agents.length === 0) continue
    let changed = false
    agents.forEach((agent, i) => {
      const bound = parseBound(agent.boundModel)
      if (!bound) return
      const path = `${agentsPath} agents[${i}].boundModel`
      if (isBoundModelAvailable(bound, availability)) {
        findings.push({ path, original: bound, action: 'keep' })
      } else {
        agent.boundModel = { ...defaultModel }
        changed = true
        findings.push({
          path,
          original: bound,
          action: 'rewrite_to_default',
          message: `Rewrote to ${defaultModel.providerID}/${defaultModel.modelID}`,
        })
      }
    })
    if (changed) {
      if (wrapper === 'array') writeJson(agentsPath, agents)
      else writeJson(agentsPath, { ...(raw as object), agents })
    }
  }

  const rewritten = findings.some((f) => f.action === 'rewrite_to_default')
  const failed = findings.some((f) => f.action === 'error')
  return {
    status: failed ? 'failed' : rewritten ? 'rewritten' : 'ok',
    defaultModel,
    findings,
    reviewedAt,
  }
}
