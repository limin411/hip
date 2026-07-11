import type { MemoryModelRef } from '@hip/protocol'
import { resolveApiKey } from '../config/auth-file.js'
import { resolveProviderBaseURL } from '../config/providers.js'

export interface MemoryEmbeddingClient {
  embed(texts: string[]): Promise<number[][]>
}

/** Stable key for embedding model identity (meta + row model_key). */
export function embeddingModelKey(ref: MemoryModelRef): string {
  const base = ref.baseURL?.trim()
  if (base) return `${ref.providerID}/${ref.modelID}@${base.replace(/\/$/, '')}`
  return `${ref.providerID}/${ref.modelID}`
}

/** Title + content, truncated for embed API payload size. */
export function truncateForEmbed(title: string, content: string, maxChars = 8000): string {
  const s = `${title}\n${content}`
  return s.length <= maxChars ? s : s.slice(0, maxChars)
}

/**
 * OpenAI-compatible `POST {baseURL}/embeddings` client.
 * Throws on missing API key or non-2xx; callers treat embed as best-effort.
 */
export function createOpenAICompatibleEmbeddingClient(ref: MemoryModelRef): MemoryEmbeddingClient {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return []
      const key = resolveApiKey(ref.providerID)
      if (!key) throw new Error('MemoryEmbeddingClient: no_api_key')
      const base = (ref.baseURL || resolveProviderBaseURL(ref.providerID)).replace(/\/$/, '')
      const res = await fetch(`${base}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: ref.modelID, input: texts }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(
          `MemoryEmbeddingClient: embed_http_${res.status}${body ? ` ${body.slice(0, 200)}` : ''}`,
        )
      }
      const json = (await res.json()) as {
        data?: Array<{ embedding?: number[]; index?: number }>
      }
      if (!Array.isArray(json.data)) {
        throw new Error('MemoryEmbeddingClient: invalid embeddings response')
      }
      // OpenAI may return data out of order; sort by index when present.
      const sorted = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      return sorted.map((d, i) => {
        if (!Array.isArray(d.embedding) || d.embedding.length === 0) {
          throw new Error(`MemoryEmbeddingClient: missing embedding at index ${i}`)
        }
        return d.embedding
      })
    },
  }
}
