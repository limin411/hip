/**
 * Resolve which wire protocol a chat provider should use.
 *
 * models.dev tags Anthropic Messages providers with npm `@ai-sdk/anthropic`
 * (MiniMax, Kimi-for-coding, freemodel, …). The UI already admits those ids;
 * runtime must honor the same signal instead of only `providerID === 'anthropic'`.
 */
import { readCatalog } from './catalog.js'
import { ANTHROPIC_DEFAULT_BASE_URL } from './providers.js'

export type ChatApiKind = 'openai' | 'anthropic'

const ANTHROPIC_NPM = '@ai-sdk/anthropic'

/** Path segment that marks Anthropic-compatible custom / catalog bases (e.g. MiniMax). */
const ANTHROPIC_PATH_RE = /\/anthropic(?:\/|$)/i

/**
 * Decide openai-compatible vs Anthropic Messages for a provider + optional base URL.
 * Order: official id → catalog npm → URL path heuristic → openai.
 */
export function resolveChatApiKind(providerID: string, baseURL?: string): ChatApiKind {
  if (providerID === 'anthropic') return 'anthropic'
  const npm = readCatalog()[providerID]?.npm
  if (npm === ANTHROPIC_NPM) return 'anthropic'
  const base = baseURL?.trim() ?? ''
  if (base && ANTHROPIC_PATH_RE.test(base)) return 'anthropic'
  return 'openai'
}

/**
 * Anthropic SDK `baseURL` / ChatAnthropic `anthropicApiUrl`.
 * SDK default is `https://api.anthropic.com` (no `/v1`); paths are `{base}/v1/messages`.
 * models.dev often stores `…/anthropic/v1` — strip trailing `/v1` to avoid `…/v1/v1/messages`.
 * Empty → undefined so the SDK keeps its official default.
 */
export function normalizeAnthropicApiUrl(baseURL?: string): string | undefined {
  let u = baseURL?.trim() ?? ''
  if (!u) return undefined
  u = u.replace(/\/+$/, '')
  if (u.endsWith('/v1')) u = u.slice(0, -3).replace(/\/+$/, '')
  return u || undefined
}

/**
 * Base for raw `POST {base}/messages` probes.
 * Official default is `https://api.anthropic.com/v1`.
 * Catalog bases may be `…/anthropic` or `…/anthropic/v1` — ensure a single trailing `/v1`.
 */
export function anthropicMessagesBase(baseURL?: string): string {
  let u = baseURL?.trim() || ANTHROPIC_DEFAULT_BASE_URL
  u = u.replace(/\/+$/, '')
  if (!u.endsWith('/v1')) u = `${u}/v1`
  return u
}
