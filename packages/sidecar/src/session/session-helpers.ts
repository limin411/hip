import type { SessionConfig, PermissionMode } from '@hip/protocol'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { HumanMessage, type BaseMessage } from '@langchain/core/messages'
import { getActiveModel } from '../config/providers.js'
import { buildChatModel } from './model-factory.js'
import type { PermissionChoice } from './agents/types.js'

export function resolveModel(config: SessionConfig): string {
  return config.model || (config.thinking === false ? 'deepseek-chat' : 'deepseek-reasoner')
}

export function resolveModelChoice(
  config: Pick<SessionConfig, 'llmProvider' | 'model' | 'baseURL'>,
  fallback: { providerID: string; modelID: string; baseURL: string },
  profileBinding?: { providerID: string; modelID: string },
): { providerID: string; modelID: string; baseURL: string } {
  if (profileBinding) {
    return { providerID: profileBinding.providerID, modelID: profileBinding.modelID, baseURL: config.baseURL || fallback.baseURL }
  }
  if (config.model) {
    return { providerID: config.llmProvider || fallback.providerID, modelID: config.model, baseURL: config.baseURL || fallback.baseURL }
  }
  return fallback
}

export function buildModel(config: SessionConfig, profileBinding?: { providerID: string; modelID: string }): BaseChatModel {
  return buildChatModel(resolveModelChoice(config, getActiveModel(), profileBinding))
}

/** Permission kinds that are considered safe (non-destructive) and auto-resolve
 *  in chat mode without emitting a `permission:request` to the user. */
export const SAFE_KINDS = new Set(['read', 'fetch', 'other'])

/**
 * Auto-resolve safe (non-file-modifying) permission requests without user prompting.
 * Returns a {@link PermissionChoice} if the request should be auto-resolved, or
 * `null` if it should go through the normal HITL prompt flow.
 */
export function tryAutoResolvePermission(
  mode: PermissionMode,
  kind: string,
  options: Array<{ optionId: string; kind: string }>,
): PermissionChoice | null {
  if (mode === 'full') return null
  if (!SAFE_KINDS.has(kind)) return null
  const allowOpt = options.find((o) => o.kind.startsWith('allow'))
  if (allowOpt) return { optionId: allowOpt.optionId }
  if (options.length > 0) return { optionId: options[0].optionId }
  return { cancelled: true }
}

export function logNonCritical(label: string, err: unknown): void {
  console.warn(`[session:${label}]`, err instanceof Error ? err.message : String(err))
}

export function lastUserText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.getType() !== 'human') continue
    if (typeof m.content === 'string') return m.content
    const firstText = m.content.find((b): b is { type: 'text'; text: string } => b.type === 'text')
    return firstText?.text ?? ''
  }
  return ''
}

/** Remove image_url content parts from HumanMessages so a text-only main model never
 *  receives them. Call this at invocation time; durable storage keeps the full parts. */
export function stripImageContentParts(messages: BaseMessage[]): BaseMessage[] {
  return messages.map((m) => {
    if (!(m instanceof HumanMessage)) return m
    const content = m.content
    if (!Array.isArray(content)) return m
    const filtered = content.filter((p) => {
      if (p != null && typeof p === 'object' && 'type' in p) {
        return (p as { type: string }).type !== 'image_url'
      }
      return true
    })
    if (filtered.length === content.length) return m
    if (filtered.length === 0) return new HumanMessage('')
    if (filtered.length === 1 && (filtered[0] as { type: string }).type === 'text') {
      return new HumanMessage((filtered[0] as { text: string }).text)
    }
    return new HumanMessage({ content: filtered })
  })
}

export function isImageAttachment(a: { mimeType: string }): boolean {
  return a.mimeType.startsWith('image/')
}

export function parseToolInput(input: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(input)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch (err) { logNonCritical('parseToolInput', err) }
  return {}
}
