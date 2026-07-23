import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  classifyCompletionStatus,
  classifyModelsListFinalStatus,
  resetProviderProbeStateForTests,
  runProviderProbe,
} from './provider-probe.js'

const fetchMock = vi.fn()

beforeEach(() => {
  resetProviderProbeStateForTests()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  delete process.env.HIP_KEY_PROBE
  process.env.HIP_MODEL_DEEPSEEK_API_KEY = 'sk-test-deepseek-key-1234567890'
  process.env.HIP_MODEL_ANTHROPIC_API_KEY = 'sk-ant-test-key-1234567890'
  process.env.HIP_MODEL_HIP_MEMORY_EMBEDDING_API_KEY = 'sk-emb-test-key-1234567890'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.HIP_MODEL_DEEPSEEK_API_KEY
  delete process.env.HIP_MODEL_ANTHROPIC_API_KEY
  delete process.env.HIP_MODEL_HIP_MEMORY_EMBEDDING_API_KEY
  delete process.env.HIP_KEY_PROBE
  resetProviderProbeStateForTests()
})

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('classifyCompletionStatus', () => {
  it('maps auth, model, rate, and generic errors', () => {
    expect(classifyCompletionStatus(401)).toBe('AUTH_FAILED')
    expect(classifyCompletionStatus(403)).toBe('AUTH_FAILED')
    expect(classifyCompletionStatus(404)).toBe('MODEL_NOT_FOUND')
    expect(classifyCompletionStatus(429)).toBe('RATE_LIMITED')
    expect(classifyCompletionStatus(500)).toBe('PROVIDER_ERROR')
    expect(classifyCompletionStatus(200)).toBe('OK')
  })
})

describe('classifyModelsListFinalStatus', () => {
  it('does not map 404 to MODEL_NOT_FOUND', () => {
    expect(classifyModelsListFinalStatus(404)).toBe('PROVIDER_ERROR')
    expect(classifyModelsListFinalStatus(401)).toBe('AUTH_FAILED')
  })
})

describe('runProviderProbe', () => {
  it('returns PROBE_DISABLED when HIP_KEY_PROBE=0', async () => {
    process.env.HIP_KEY_PROBE = '0'
    const r = await runProviderProbe({
      purpose: 'chat',
      providerID: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
    })
    expect(r.code).toBe('PROBE_DISABLED')
    expect(r.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns MISSING_KEY when no key', async () => {
    delete process.env.HIP_MODEL_DEEPSEEK_API_KEY
    const r = await runProviderProbe({
      purpose: 'chat',
      providerID: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
    })
    expect(r.code).toBe('MISSING_KEY')
  })

  it('returns MISSING_BASE_URL for non-anthropic chat without base', async () => {
    const r = await runProviderProbe({ purpose: 'chat', providerID: 'deepseek' })
    expect(r.code).toBe('MISSING_BASE_URL')
  })

  it('succeeds on OpenAI-compat GET /models 2xx without completion', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }))
    const r = await runProviderProbe({
      purpose: 'chat',
      providerID: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
    })
    expect(r.ok).toBe(true)
    expect(r.code).toBe('OK')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/models')
  })

  it('falls back to completion when /models returns 404', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(200, { choices: [] }))
    const r = await runProviderProbe({
      purpose: 'chat',
      providerID: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
    })
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toContain('/chat/completions')
  })

  it('maps 401 on /models to AUTH_FAILED without fallback', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}))
    const r = await runProviderProbe({
      purpose: 'chat',
      providerID: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
    })
    expect(r.code).toBe('AUTH_FAILED')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses draft apiKey over env', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }))
    await runProviderProbe({
      purpose: 'chat',
      providerID: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
      draftApiKey: 'sk-draft-key-abcdefghijklmnopqrst',
    })
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-draft-key-abcdefghijklmnopqrst')
  })

  it('probes Anthropic via Messages API', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: [] }))
    const r = await runProviderProbe({
      purpose: 'chat',
      providerID: 'anthropic',
    })
    expect(r.ok).toBe(true)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/messages')
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['x-api-key']).toBeTruthy()
    expect(headers['anthropic-version']).toBe('2023-06-01')
  })

  it('probes Anthropic-compatible catalog hosts via Messages (not chat/completions)', async () => {
    process.env.HIP_MODEL_MINIMAX_CN_CODING_PLAN_API_KEY = 'sk-minimax-test-key-1234567890'
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: [] }))
    const r = await runProviderProbe({
      purpose: 'chat',
      providerID: 'minimax-cn-coding-plan',
      baseURL: 'https://api.minimaxi.com/anthropic/v1',
      modelID: 'MiniMax-M3',
    })
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toBe('https://api.minimaxi.com/anthropic/v1/messages')
    expect(url).not.toContain('chat/completions')
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-minimax-test-key-1234567890')
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { model: string }
    expect(body.model).toBe('MiniMax-M3')
    delete process.env.HIP_MODEL_MINIMAX_CN_CODING_PLAN_API_KEY
  })

  it('probes custom /anthropic baseURL via Messages without catalog npm', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: [] }))
    const r = await runProviderProbe({
      purpose: 'chat',
      providerID: 'my-gateway',
      baseURL: 'https://api.minimaxi.com/anthropic/v1',
      modelID: 'MiniMax-M3',
      draftApiKey: 'sk-custom-anthropic-key-1234567890',
    })
    expect(r.ok).toBe(true)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.minimaxi.com/anthropic/v1/messages')
  })

  it('returns INCOMPATIBLE_PROVIDER for azure', async () => {
    const r = await runProviderProbe({
      purpose: 'chat',
      providerID: 'azure',
      baseURL: 'https://example.openai.azure.com',
      draftApiKey: 'sk-azure-test-key-1234567890',
    })
    expect(r.code).toBe('INCOMPATIBLE_PROVIDER')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns PROBE_UNSUPPORTED for rerank after prechecks', async () => {
    const r = await runProviderProbe({
      purpose: 'rerank',
      providerID: 'hip-memory-rerank',
      baseURL: 'https://api.example.com/v1',
      modelID: 'rerank-1',
      draftApiKey: 'sk-rerank-test-key-1234567890',
    })
    expect(r.code).toBe('PROBE_UNSUPPORTED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('probes embedding and validates vector', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { data: [{ embedding: [0.1, 0.2], index: 0 }] }),
    )
    const r = await runProviderProbe({
      purpose: 'embedding',
      providerID: 'hip-memory-embedding',
      baseURL: 'https://api.openai.com/v1',
      modelID: 'text-embedding-3-small',
    })
    expect(r.ok).toBe(true)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/embeddings')
  })

  it('returns cached result on second call without second fetch', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }))
    const a = await runProviderProbe({
      purpose: 'chat',
      providerID: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
    })
    const b = await runProviderProbe({
      purpose: 'chat',
      providerID: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
    })
    expect(a.ok).toBe(true)
    expect(b.cached).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns NETWORK on fetch throw', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const r = await runProviderProbe({
      purpose: 'chat',
      providerID: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
    })
    expect(r.code).toBe('NETWORK')
  })
})
