import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { getActiveModel, cheapModelFor, resolveProviderBaseURL } from '../config/providers.js'
import { resolveApiKey } from '../config/auth-file.js'
import { buildChatModel } from '../session/model-factory.js'
import { loadMemoryConfig } from './config.js'

export interface MemoryLlmCompleteOpts {
  model?: string
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  timeoutMs?: number
}

export interface MemoryLlmClient {
  completeJson(system: string, user: string, opts?: MemoryLlmCompleteOpts): Promise<unknown>
}

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_TOKENS = 4096
const DEFAULT_TEMPERATURE = 0

/** Resolve provider/model/baseURL from an override (`provider/model` or bare model id) or active + cheap default. */
export function resolveMemoryExtractModel(override?: string): {
  providerID: string
  modelID: string
  baseURL: string
} {
  const active = getActiveModel()
  if (!override?.trim()) {
    return {
      providerID: active.providerID,
      modelID: cheapModelFor(active.providerID, active.modelID),
      baseURL: active.baseURL,
    }
  }
  const raw = override.trim()
  const slash = raw.indexOf('/')
  if (slash > 0) {
    const providerID = raw.slice(0, slash)
    const modelID = raw.slice(slash + 1)
    if (providerID && modelID) {
      return {
        providerID,
        modelID,
        baseURL: providerID === active.providerID ? active.baseURL : resolveProviderBaseURL(providerID),
      }
    }
  }
  return {
    providerID: active.providerID,
    modelID: raw,
    baseURL: active.baseURL,
  }
}

/** Strip markdown fences and parse the first JSON value from model text. */
export function parseJsonFromLlmText(raw: string): unknown {
  let json = raw.trim()
  if (json.startsWith('```')) {
    const end = json.indexOf('\n')
    json = end >= 0 ? json.slice(end + 1).trim() : json.slice(3).trim()
    if (json.endsWith('```')) json = json.slice(0, -3).trim()
  }
  // Prefer full parse; if trailing prose, take first {...} object.
  try {
    return JSON.parse(json)
  } catch {
    const start = json.indexOf('{')
    const end = json.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(json.slice(start, end + 1))
    }
    throw new Error('MemoryLlmClient: response is not valid JSON')
  }
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === 'string') return b
        if (b && typeof b === 'object' && 'text' in b && typeof (b as { text: unknown }).text === 'string') {
          return (b as { text: string }).text
        }
        return ''
      })
      .join('')
  }
  if (content == null) return ''
  return String(content)
}

/**
 * Production MemoryLlmClient. Returns null when the resolved provider has no API key.
 * Uses buildChatModel + invoke — never RealModelRunner / session tool loops.
 */
export function createDefaultMemoryLlmClient(opts?: {
  extractModel?: string
}): MemoryLlmClient | null {
  const extractModel = opts?.extractModel ?? loadMemoryConfig().extractModel
  const defaultChoice = resolveMemoryExtractModel(extractModel)
  if (!resolveApiKey(defaultChoice.providerID)) return null

  return {
    async completeJson(system: string, user: string, completeOpts?: MemoryLlmCompleteOpts): Promise<unknown> {
      const choice = completeOpts?.model
        ? resolveMemoryExtractModel(completeOpts.model)
        : defaultChoice
      if (!resolveApiKey(choice.providerID)) {
        throw new Error(`MemoryLlmClient: no API key for provider ${choice.providerID}`)
      }

      const model = buildChatModel(choice)
      const maxTokens = completeOpts?.maxTokens ?? DEFAULT_MAX_TOKENS
      const temperature = completeOpts?.temperature ?? DEFAULT_TEMPERATURE
      const timeoutMs = completeOpts?.timeoutMs ?? DEFAULT_TIMEOUT_MS

      const bound = bindGenerationParams(model, { maxTokens, temperature })
      const text = await invokeWithTimeout(
        bound,
        system,
        user,
        timeoutMs,
        completeOpts?.signal,
      )
      return parseJsonFromLlmText(text)
    },
  }
}

function bindGenerationParams(
  model: BaseChatModel,
  params: { maxTokens: number; temperature: number },
): BaseChatModel {
  const m = model as BaseChatModel & {
    bind?: (p: Record<string, unknown>) => BaseChatModel
    withConfig?: (p: Record<string, unknown>) => BaseChatModel
  }
  if (typeof m.bind === 'function') {
    return m.bind({ maxTokens: params.maxTokens, temperature: params.temperature })
  }
  if (typeof m.withConfig === 'function') {
    return m.withConfig({ maxTokens: params.maxTokens, temperature: params.temperature })
  }
  return model
}

async function invokeWithTimeout(
  model: BaseChatModel,
  system: string,
  user: string,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<string> {
  if (parentSignal?.aborted) {
    throw new Error('MemoryLlmClient: aborted')
  }

  const controller = new AbortController()
  const onParentAbort = () => controller.abort()
  parentSignal?.addEventListener('abort', onParentAbort)

  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const invokePromise = (async () => {
    const res = await model.invoke(
      [new SystemMessage(system), new HumanMessage(user)],
      { signal: controller.signal },
    )
    return contentToText(res.content)
  })()

  const abortPromise = new Promise<never>((_, reject) => {
    const fail = () => {
      reject(
        new Error(
          parentSignal?.aborted
            ? 'MemoryLlmClient: aborted'
            : `MemoryLlmClient: timed out after ${timeoutMs}ms`,
        ),
      )
    }
    if (controller.signal.aborted) {
      fail()
      return
    }
    controller.signal.addEventListener('abort', fail, { once: true })
  })

  try {
    return await Promise.race([invokePromise, abortPromise])
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', onParentAbort)
  }
}
