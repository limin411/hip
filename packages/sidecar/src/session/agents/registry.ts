import type { AgentConfig } from '@hip/protocol'
import { resolveEffectiveConfig } from '../../config/hip-config.js'
import { resolveApiKey } from '../../config/auth-file.js'
import { resolveProviderBaseURL } from '../../config/providers.js'
import type { Catalog } from '../../config/catalog.js'
import { readCatalog } from '../../config/catalog.js'

const STOP_WORDS = new Set([
  'the','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','must','shall','can','need','dare','ought','used','to','of','in','for','on','with','at','by','from','as','into','through','during','before','after','above','below','between','under','over','again','further','then','once','here','there','when','where','why','how','all','any','both','each','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','just','and','but','if','or','because','until','while','what','which','who','whom','this','that','these','those','am','it','its','their','them','they','we','our','you','your','me','my','he','she','his','her','him',
  // Chinese stop words removed — CJK text is not word-segmented by the current regex, so individual
  // Chinese words are never isolated as tokens.
].filter((w) => w.length >= 2))

function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w))
  return [...new Set(words)]
}

export interface ResolvedModel { providerID: string; modelID: string; baseURL: string; apiKey?: string }

/** Read the registered external agents from hip.toml (global + project). */
export function readAgentsConfig(cwd: string): AgentConfig[] {
  return resolveEffectiveConfig(cwd).agents ?? []
}

/** Resolve an agent's bound model to a concrete {providerID, modelID, baseURL, apiKey}, or null. */
export function resolveAgentModel(agent: AgentConfig, cwd: string): ResolvedModel | null {
  if (!agent.boundModel) return null
  const { providerID, modelID } = agent.boundModel
  // Resolve baseURL from the effective config (global + project) so a project-level provider
  // override applies — consistent with how readAgentsConfig() reads the agent list. Fall back
  // to the global default resolver when the provider has no entry.
  const override = resolveEffectiveConfig(cwd).providers?.find((p) => p.id === providerID)?.baseUrl
  const baseURL = override || resolveProviderBaseURL(providerID)
  return { providerID, modelID, baseURL, apiKey: resolveApiKey(providerID) }
}

/** Pick the best internal multimodal agent for an image turn.
 *  - Filter to enabled, non-builtin internal agents with a multimodal boundModel.
 *  - If the user prompt contains keywords matching an agent's prompt/description, pick the first match.
 *  - Otherwise fall back to the first eligible agent.
 *  - Returns null if no eligible agent exists.
 */
export function selectImageAgent(cwd: string, userPrompt: string, catalog?: Catalog): AgentConfig | null {
  const cat = catalog ?? readCatalog()
  const agents = readAgentsConfig(cwd).filter((a) => {
    if (a.kind !== 'internal' || !a.enabled || a.id === 'builtin') return false
    if (!a.boundModel) return false
    return !!cat[a.boundModel.providerID]?.models[a.boundModel.modelID]?.attachment
  })
  if (agents.length === 0) return null
  const keywords = extractKeywords(userPrompt)
  if (keywords.length > 0) {
    const matched = agents.find((a) =>
      keywords.some((kw) =>
        (a.prompt ?? '').toLowerCase().includes(kw) ||
        (a.description ?? '').toLowerCase().includes(kw),
      ),
    )
    if (matched) return matched
  }
  return agents[0]
}
