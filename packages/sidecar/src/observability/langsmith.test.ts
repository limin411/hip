import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyLangSmithConfig,
  flushLangSmithTraces,
  initLangSmith,
  isLangSmithTracingEnabled,
  langSmithModelCallConfig,
  langSmithStatus,
  loadLangSmithFromHipConfig,
  tracingChildMetadata,
  tracingInvokeFields,
  withoutLangSmithTracing,
} from './langsmith.js'
import { CallbackManager } from '@langchain/core/callbacks/manager'

const KEYS = [
  'LANGSMITH_TRACING',
  'LANGSMITH_TRACING_V2',
  'LANGCHAIN_TRACING_V2',
  'LANGCHAIN_TRACING',
  'LANGSMITH_API_KEY',
  'LANGCHAIN_API_KEY',
  'LANGSMITH_PROJECT',
  'LANGCHAIN_PROJECT',
  'LANGSMITH_ENDPOINT',
  'LANGCHAIN_ENDPOINT',
  'HIP_CONFIG_PATH',
] as const

const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {}
const tmpDirs: string[] = []

function clearAll(): void {
  for (const k of KEYS) {
    if (!(k in saved)) saved[k] = process.env[k]
    delete process.env[k]
  }
}

function restoreAll(): void {
  for (const k of KEYS) {
    const v = saved[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
    delete saved[k]
  }
  for (const d of tmpDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

function writeHipToml(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'hip-ls-'))
  tmpDirs.push(dir)
  const p = join(dir, 'hip.toml')
  writeFileSync(p, body)
  return p
}

afterEach(() => {
  restoreAll()
})

describe('isLangSmithTracingEnabled', () => {
  it('is false by default', () => {
    clearAll()
    expect(isLangSmithTracingEnabled()).toBe(false)
  })

  it('reads LANGSMITH_TRACING=true', () => {
    clearAll()
    process.env.LANGSMITH_TRACING = 'true'
    expect(isLangSmithTracingEnabled()).toBe(true)
  })

  it('reads LANGCHAIN_TRACING_V2=true', () => {
    clearAll()
    process.env.LANGCHAIN_TRACING_V2 = 'true'
    expect(isLangSmithTracingEnabled()).toBe(true)
  })

  it('ignores non-true values', () => {
    clearAll()
    process.env.LANGSMITH_TRACING = '1'
    expect(isLangSmithTracingEnabled()).toBe(false)
  })
})

describe('applyLangSmithConfig / loadLangSmithFromHipConfig', () => {
  it('applies hip.toml [langsmith] into process.env', () => {
    clearAll()
    const p = writeHipToml(`version = 1

[langsmith]
enabled = true
api_key = "lsv2_from_file"
project = "hip"
endpoint = "https://eu.api.smith.langchain.com"
`)
    const section = loadLangSmithFromHipConfig(p)
    expect(section).toEqual({
      enabled: true,
      apiKey: 'lsv2_from_file',
      project: 'hip',
      endpoint: 'https://eu.api.smith.langchain.com',
    })
    expect(process.env.LANGSMITH_TRACING).toBe('true')
    expect(process.env.LANGSMITH_API_KEY).toBe('lsv2_from_file')
    expect(process.env.LANGSMITH_PROJECT).toBe('hip')
    expect(process.env.LANGSMITH_ENDPOINT).toBe('https://eu.api.smith.langchain.com')
    expect(isLangSmithTracingEnabled()).toBe(true)
  })

  it('does not overwrite existing env vars', () => {
    clearAll()
    process.env.LANGSMITH_TRACING = 'true'
    process.env.LANGSMITH_API_KEY = 'from_env'
    process.env.LANGSMITH_PROJECT = 'env-project'
    applyLangSmithConfig({
      enabled: true,
      apiKey: 'from_file',
      project: 'file-project',
      endpoint: 'https://eu.api.smith.langchain.com',
    })
    expect(process.env.LANGSMITH_API_KEY).toBe('from_env')
    expect(process.env.LANGSMITH_PROJECT).toBe('env-project')
    expect(process.env.LANGSMITH_ENDPOINT).toBe('https://eu.api.smith.langchain.com')
  })

  it('initLangSmith loads HIP_CONFIG_PATH and reports status', () => {
    clearAll()
    const p = writeHipToml(`version = 1
[langsmith]
enabled = true
api_key = "lsv2_init"
project = "hip-init"
`)
    process.env.HIP_CONFIG_PATH = p
    const status = initLangSmith()
    expect(status.enabled).toBe(true)
    expect(status.hasApiKey).toBe(true)
    expect(status.project).toBe('hip-init')
    expect(status.fromConfig).toBe(true)
  })
})

describe('langSmithStatus', () => {
  it('reports project and endpoint without exposing secrets', () => {
    clearAll()
    process.env.LANGSMITH_TRACING = 'true'
    process.env.LANGSMITH_API_KEY = 'lsv2_secret'
    process.env.LANGSMITH_PROJECT = 'hip'
    process.env.LANGSMITH_ENDPOINT = 'https://eu.api.smith.langchain.com'
    const s = langSmithStatus()
    expect(s).toEqual({
      enabled: true,
      project: 'hip',
      endpoint: 'https://eu.api.smith.langchain.com',
      hasApiKey: true,
    })
  })
})

describe('tracingInvokeFields', () => {
  it('returns empty when disabled', () => {
    clearAll()
    expect(tracingInvokeFields({ sessionId: 's1' })).toEqual({})
  })

  it('uses sessionId as runName and thread keys for grouping', () => {
    clearAll()
    process.env.LANGSMITH_TRACING = 'true'
    const fields = tracingInvokeFields({
      kind: 'session-turn',
      sessionId: 'sess-abc-123',
      turnId: 'turn',
      agentId: 'supervisor',
      title: 'ignored for runName',
    })
    expect(fields.runName).toBe('sess-abc-123')
    expect(fields.tags).toEqual(['hip', 'session-turn'])
    expect(fields.metadata).toMatchObject({
      ls_integration: 'hip',
      run_kind: 'session-turn',
      // LangSmith Threads: both keys group multi-turn runs into one conversation
      thread_id: 'sess-abc-123',
      session_id: 'sess-abc-123',
      turn_id: 'turn',
      agent_id: 'supervisor',
      session_title: 'ignored for runName',
    })
  })

  it('falls back to hip.<kind> when sessionId is missing', () => {
    clearAll()
    process.env.LANGSMITH_TRACING = 'true'
    const fields = tracingInvokeFields({
      kind: 'subagent',
      title: 'some title',
    })
    expect(fields.runName).toBe('hip.subagent')
  })

  it('truncates very long session ids', () => {
    clearAll()
    process.env.LANGSMITH_TRACING = 'true'
    const long = 's'.repeat(250)
    const fields = tracingInvokeFields({ sessionId: long })
    expect(fields.runName!.length).toBe(200)
  })
})

describe('langSmithModelCallConfig', () => {
  it('returns empty when tracing disabled', () => {
    clearAll()
    expect(langSmithModelCallConfig({ runName: 'hip.summarize', sessionId: 's1' })).toEqual({})
  })

  it('names summarize runs and attaches thread keys', () => {
    clearAll()
    process.env.LANGSMITH_TRACING = 'true'
    expect(langSmithModelCallConfig({ runName: 'hip.summarize', sessionId: 'sess-1', kind: 'summarize' })).toEqual({
      runName: 'hip.summarize',
      tags: ['hip', 'summarize'],
      metadata: {
        ls_integration: 'hip',
        run_kind: 'summarize',
        thread_id: 'sess-1',
        session_id: 'sess-1',
      },
    })
  })
})

describe('withoutLangSmithTracing', () => {
  it('suppresses LangChainTracer while tracing env is on', async () => {
    clearAll()
    process.env.LANGSMITH_TRACING = 'true'
    process.env.LANGSMITH_API_KEY = 'lsv2_test_key'

    const outside = await CallbackManager.configure(
      undefined, undefined, undefined, undefined, undefined, undefined, { verbose: false },
    )
    expect(outside?.handlers.some((h) => h.name === 'langchain_tracer')).toBe(true)

    const insideHasTracer = await withoutLangSmithTracing(async () => {
      const cm = await CallbackManager.configure(
        undefined, undefined, undefined, undefined, undefined, undefined, { verbose: false },
      )
      return cm?.handlers.some((h) => h.name === 'langchain_tracer') ?? false
    })
    expect(insideHasTracer).toBe(false)
  })
})

describe('applyLangSmithConfig reliability flags', () => {
  it('sets background=false and LANGCHAIN_* aliases when enabling', () => {
    clearAll()
    applyLangSmithConfig({
      enabled: true,
      apiKey: 'lsv2_x',
      project: 'hip',
      endpoint: 'https://eu.api.smith.langchain.com',
    })
    expect(process.env.LANGSMITH_TRACING).toBe('true')
    expect(process.env.LANGCHAIN_TRACING_V2).toBe('true')
    expect(process.env.LANGCHAIN_CALLBACKS_BACKGROUND).toBe('false')
    expect(process.env.LANGCHAIN_PROJECT).toBe('hip')
    expect(process.env.LANGCHAIN_API_KEY).toBe('lsv2_x')
    expect(process.env.LANGCHAIN_ENDPOINT).toBe('https://eu.api.smith.langchain.com')
  })
})

describe('flushLangSmithTraces', () => {
  it('is a no-op when tracing is off', async () => {
    clearAll()
    await expect(flushLangSmithTraces()).resolves.toBeUndefined()
  })
})

describe('tracingChildMetadata', () => {
  it('returns base unchanged when disabled', () => {
    clearAll()
    expect(tracingChildMetadata({ sessionId: 's' }, { a: 1 })).toEqual({ a: 1 })
    expect(tracingChildMetadata({ sessionId: 's' })).toBeUndefined()
  })

  it('merges session + thread fields when enabled', () => {
    clearAll()
    process.env.LANGSMITH_TRACING = 'true'
    expect(tracingChildMetadata({ sessionId: 's', agentId: 'a' }, { step: 2 })).toEqual({
      step: 2,
      ls_integration: 'hip',
      thread_id: 's',
      session_id: 's',
      agent_id: 'a',
    })
  })
})
