import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createOpenAICompatibleEmbeddingClient,
  embeddingModelKey,
  truncateForEmbed,
} from './embedding-client.js'

describe('embedding-client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('embeddingModelKey includes baseURL when set', () => {
    expect(embeddingModelKey({ providerID: 'openai', modelID: 'text-embedding-3-small' })).toBe(
      'openai/text-embedding-3-small',
    )
    expect(
      embeddingModelKey({
        providerID: 'openai',
        modelID: 'text-embedding-3-small',
        baseURL: 'https://api.example.com/v1/',
      }),
    ).toBe('openai/text-embedding-3-small@https://api.example.com/v1')
  })

  it('truncateForEmbed caps length', () => {
    const long = 'x'.repeat(10_000)
    const out = truncateForEmbed('t', long, 100)
    expect(out.length).toBe(100)
    expect(out.startsWith('t\n')).toBe(true)
  })

  it('createOpenAICompatibleEmbeddingClient posts /embeddings and maps data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
      })),
    )
    // hip provider key env (see providerKeyEnv)
    const keyEnv = 'HIP_MODEL_OPENAI_API_KEY'
    const prev = process.env[keyEnv]
    process.env[keyEnv] = 'test-key'
    try {
      const client = createOpenAICompatibleEmbeddingClient({
        providerID: 'openai',
        modelID: 'text-embedding-3-small',
        baseURL: 'https://api.openai.com/v1',
      })
      const vecs = await client.embed(['a', 'b'])
      expect(vecs).toEqual([
        [1, 0],
        [0, 1],
      ])
      expect(fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
          }),
        }),
      )
    } finally {
      if (prev === undefined) delete process.env[keyEnv]
      else process.env[keyEnv] = prev
    }
  })

  it('throws no_api_key when key missing', async () => {
    const keyEnv = 'HIP_MODEL_OPENAI_API_KEY'
    const prev = process.env[keyEnv]
    delete process.env[keyEnv]
    const prevAuth = process.env.HIP_AUTH_PATH
    process.env.HIP_AUTH_PATH = '/tmp/hip-no-auth-file-for-embed-test.json'
    try {
      const client = createOpenAICompatibleEmbeddingClient({
        providerID: 'openai',
        modelID: 'text-embedding-3-small',
        baseURL: 'https://api.openai.com/v1',
      })
      await expect(client.embed(['x'])).rejects.toThrow(/no_api_key/)
    } finally {
      if (prev === undefined) delete process.env[keyEnv]
      else process.env[keyEnv] = prev
      if (prevAuth === undefined) delete process.env.HIP_AUTH_PATH
      else process.env.HIP_AUTH_PATH = prevAuth
    }
  })
})
