/**
 * Provider-visible prompt cache policy (PR-7b).
 *
 * Anthropic-first: attach `cache_control: { type: 'ephemeral' }` breakpoints at
 * the serialization boundary (last tool definition, last system part, latest
 * user message) — inspired by OpenCode's auto policy.
 *
 * OpenAI-compat: optional `prompt_cache_key` when the client supports it
 * (feature-detect); unsupported → silent no-op.
 *
 * Default: auto. `none` / `off` disables placement.
 */
import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
  type MessageContent,
} from '@langchain/core/messages'

/** Wire/config modes. `off` is accepted as an alias of `none`. */
export type CachePolicyInput = 'auto' | 'none' | 'off' | string | null | undefined

/** Resolved placement mode. */
export type CachePolicyMode = 'auto' | 'none'

/** Prompt-cache-key config for OpenAI-compat clients. */
export type PromptCacheKeyMode = 'session' | 'none'

export const EPHEMERAL_CACHE_CONTROL = { type: 'ephemeral' as const }

export type CacheControlEphemeral = typeof EPHEMERAL_CACHE_CONTROL

/**
 * Resolve config/env string to auto | none.
 * undefined / empty / unknown → auto (default on; math favors Anthropic cache).
 */
export function resolveCachePolicy(input?: CachePolicyInput): CachePolicyMode {
  if (input == null) return 'auto'
  const v = String(input).trim().toLowerCase()
  if (v === '' || v === 'auto') return 'auto'
  if (v === 'none' || v === 'off' || v === '0' || v === 'false') return 'none'
  return 'auto'
}

export function resolvePromptCacheKeyMode(input?: string | null): PromptCacheKeyMode {
  if (input == null) return 'session'
  const v = String(input).trim().toLowerCase()
  if (v === 'none' || v === 'off' || v === '0' || v === 'false') return 'none'
  return 'session'
}

// ── Anthropic message breakpoints ──────────────────────────────────────────

function isSystemMsg(m: BaseMessage): boolean {
  if (m instanceof SystemMessage) return true
  try {
    return m.getType() === 'system'
  } catch {
    return false
  }
}

function isHumanMsg(m: BaseMessage): boolean {
  if (m instanceof HumanMessage) return true
  try {
    return m.getType() === 'human'
  } catch {
    return false
  }
}

function lastIndexOf(
  messages: readonly BaseMessage[],
  pred: (m: BaseMessage) => boolean,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (pred(messages[i]!)) return i
  }
  return -1
}

function partHasCacheControl(part: unknown): boolean {
  return (
    !!part &&
    typeof part === 'object' &&
    'cache_control' in part &&
    (part as { cache_control?: unknown }).cache_control != null
  )
}

/** Attach ephemeral cache_control to the last text (or last) content part. */
export function withEphemeralCacheControl(content: MessageContent): MessageContent {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content, cache_control: EPHEMERAL_CACHE_CONTROL }]
  }
  if (!Array.isArray(content) || content.length === 0) return content

  let markAt = -1
  for (let i = content.length - 1; i >= 0; i--) {
    const p = content[i]
    if (p && typeof p === 'object' && (p as { type?: string }).type === 'text') {
      markAt = i
      break
    }
  }
  if (markAt < 0) markAt = content.length - 1
  if (partHasCacheControl(content[markAt])) return content

  return content.map((part, i) => {
    if (i !== markAt) return part
    if (part && typeof part === 'object') {
      return { ...(part as object), cache_control: EPHEMERAL_CACHE_CONTROL }
    }
    return part
  }) as MessageContent
}

function rebuildWithContent(m: BaseMessage, content: MessageContent): BaseMessage {
  if (isSystemMsg(m)) {
    return new SystemMessage({
      content,
      id: m.id,
      name: m.name,
      additional_kwargs: m.additional_kwargs,
      response_metadata: m.response_metadata,
    })
  }
  if (isHumanMsg(m)) {
    return new HumanMessage({
      content,
      id: m.id,
      name: m.name,
      additional_kwargs: m.additional_kwargs,
      response_metadata: m.response_metadata,
    })
  }
  return m
}

/**
 * Auto policy: mark last system message + latest user (human) message with
 * ephemeral cache_control. No-op when policy is none or nothing to mark.
 *
 * Does not mutate inputs. Preserves message identity when already marked /
 * nothing to do.
 */
export function applyAnthropicMessageCacheBreakpoints(
  messages: readonly BaseMessage[],
  policy: CachePolicyInput = 'auto',
): BaseMessage[] {
  if (resolveCachePolicy(policy) !== 'auto' || messages.length === 0) {
    return messages as BaseMessage[]
  }

  const systemIdx = lastIndexOf(messages, isSystemMsg)
  const userIdx = lastIndexOf(messages, isHumanMsg)
  if (systemIdx < 0 && userIdx < 0) return messages as BaseMessage[]

  let changed = false
  const out = messages.slice() as BaseMessage[]

  for (const idx of [systemIdx, userIdx]) {
    if (idx < 0) continue
    const m = out[idx]!
    const nextContent = withEphemeralCacheControl(m.content)
    if (nextContent === m.content) continue
    out[idx] = rebuildWithContent(m, nextContent)
    changed = true
  }

  return changed ? out : (messages as BaseMessage[])
}

// ── Anthropic tool breakpoints ─────────────────────────────────────────────

/**
 * Mark the last tool definition with ephemeral cache_control.
 * - Native Anthropic-shaped tools (`input_schema`) get top-level `cache_control`.
 * - LangChain tools get `extras.cache_control` (passed through by ChatAnthropic).
 * Non-mutating; unsupported shapes still return a best-effort clone.
 */
export function applyAnthropicToolCacheBreakpoints<T extends object>(
  tools: readonly T[],
  policy: CachePolicyInput = 'auto',
): T[] {
  if (resolveCachePolicy(policy) !== 'auto' || tools.length === 0) {
    return tools as T[]
  }

  const lastIdx = tools.length - 1
  const last = tools[lastIdx] as T & {
    cache_control?: unknown
    extras?: Record<string, unknown>
    input_schema?: unknown
  }
  if (last.cache_control != null || last.extras?.cache_control != null) {
    return tools as T[]
  }

  return tools.map((tool, i) => {
    if (i !== lastIdx) return tool
    const t = tool as T & {
      cache_control?: unknown
      extras?: Record<string, unknown>
      input_schema?: unknown
    }
    // Anthropic wire tool shape — pass cache_control at top level.
    if (t.input_schema != null || ('name' in t && !('schema' in t) && !('lc_namespace' in t))) {
      return { ...t, cache_control: EPHEMERAL_CACHE_CONTROL } as T
    }
    // LangChain StructuredTool / DynamicStructuredTool: extras path.
    return new Proxy(tool, {
      get(target, prop, receiver) {
        if (prop === 'extras') {
          const existing = Reflect.get(target, prop, receiver) as
            | Record<string, unknown>
            | undefined
          return { ...(existing ?? {}), cache_control: EPHEMERAL_CACHE_CONTROL }
        }
        return Reflect.get(target, prop, receiver)
      },
    }) as T
  })
}

// ── OpenAI prompt_cache_key ────────────────────────────────────────────────

/**
 * True when the chat client looks like an OpenAI-compat LangChain model that
 * accepts `promptCacheKey` (constructor field or stream/invoke option).
 * Anthropic / unknown → false (no-op).
 */
export function supportsOpenAiPromptCacheKey(model: unknown): boolean {
  if (!model || typeof model !== 'object') return false
  const m = model as {
    bound?: unknown
    promptCacheKey?: unknown
    constructor?: { name?: string }
  }
  // RunnableBinding / withConfig wrap
  if (m.bound && typeof m.bound === 'object') {
    return supportsOpenAiPromptCacheKey(m.bound)
  }
  if ('promptCacheKey' in m) return true
  const name = m.constructor?.name ?? ''
  if (
    name === 'ChatOpenAI' ||
    name === 'ReasoningChatOpenAI' ||
    name === 'ChatOpenAICompletions' ||
    name === 'ChatOpenAIResponses' ||
    name === 'BaseChatOpenAI'
  ) {
    return true
  }
  // Explicit Anthropic → no
  if (name === 'ChatAnthropic' || name === 'ChatAnthropicMessages') return false
  return false
}

export interface PromptCacheKeyOpts {
  model: unknown
  sessionId?: string | null
  cachePolicy?: CachePolicyInput
  /** Default `session` when auto. */
  promptCacheKeyMode?: PromptCacheKeyMode | string | null
}

/**
 * Return `promptCacheKey` for OpenAI stream/invoke options when:
 * - cache policy is auto
 * - promptCacheKey mode is session
 * - sessionId is non-empty
 * - client feature-detects as supporting promptCacheKey
 *
 * Otherwise undefined (silent no-op).
 */
export function resolveOpenAiPromptCacheKey(opts: PromptCacheKeyOpts): string | undefined {
  if (resolveCachePolicy(opts.cachePolicy) !== 'auto') return undefined
  if (resolvePromptCacheKeyMode(opts.promptCacheKeyMode) !== 'session') return undefined
  const sid = opts.sessionId?.trim()
  if (!sid) return undefined
  if (!supportsOpenAiPromptCacheKey(opts.model)) return undefined
  return sid
}

/** Extract a session id from LangChain-style metadata if present. */
export function sessionIdFromMetadata(
  metadata: Record<string, unknown> | undefined | null,
): string | undefined {
  if (!metadata) return undefined
  const v = metadata.sessionId ?? metadata.session_id
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}
