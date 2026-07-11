import { randomUUID } from 'node:crypto'
import type { MemoryFileConfig, Message } from '@hip/protocol'
import { resolveSessionMemoryFlags } from '../config.js'
import { redactSecrets } from '../redact.js'
import { resolveProjectKey } from '../project-key.js'
import type { MemoryStore } from '../store.js'
import type { MemoryLlmClient } from '../llm-client.js'
import {
  PHASE1_SYSTEM_PROMPT,
  buildPhase1UserPrompt,
  type Stage1LlmOutput,
} from './prompts.js'
import {
  buildPhase1Transcript,
  transcriptMeetsMinContent,
} from './transcript.js'

export type Phase1ExtractStatus = 'succeeded' | 'succeeded_no_output' | 'skipped' | 'failed'

export type Phase1ExtractResult = {
  status: Phase1ExtractStatus
  reason?: string
  stage1Id?: string
}

export type SessionMessagesLoader = {
  loadMessagesWithRuns(sessionId: string): Message[]
}

export type RunPhase1ExtractOpts = {
  store: MemoryStore
  sessionStore: SessionMessagesLoader
  sessionId: string
  llm: MemoryLlmClient | null
  config: MemoryFileConfig
  sessionConfig?: { generateMemories?: boolean; incognito?: boolean; cwd?: string }
  now?: number
  idleMinutes?: number
  /** When explicitly false, skip (caller decided session is not idle). Undefined = no idle gate. */
  isIdle?: boolean
}

function asStage1Output(raw: unknown): Stage1LlmOutput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Phase1: LLM output is not an object')
  }
  const o = raw as Record<string, unknown>
  const raw_memory = typeof o.raw_memory === 'string' ? o.raw_memory : ''
  const rollout_summary = typeof o.rollout_summary === 'string' ? o.rollout_summary : ''
  const rollout_slug = typeof o.rollout_slug === 'string' ? o.rollout_slug : undefined
  return { raw_memory, rollout_summary, ...(rollout_slug !== undefined ? { rollout_slug } : {}) }
}

/**
 * Run Phase1 extract for one session: gates → transcript → LLM → redact → upsert stage1.
 * Never throws to the turn path; returns status + optional reason.
 */
export async function runPhase1Extract(opts: RunPhase1ExtractOpts): Promise<Phase1ExtractResult> {
  const flags = resolveSessionMemoryFlags(opts.config, opts.sessionConfig ?? {})
  if (flags.incognito) {
    return { status: 'skipped', reason: 'incognito' }
  }
  if (!flags.generate) {
    return { status: 'skipped', reason: 'generate_disabled' }
  }
  if (opts.isIdle === false) {
    return { status: 'skipped', reason: 'not_idle' }
  }
  if (!opts.llm) {
    return { status: 'skipped', reason: 'no_llm' }
  }

  let messages: Message[]
  try {
    messages = opts.sessionStore.loadMessagesWithRuns(opts.sessionId)
  } catch (err) {
    return {
      status: 'failed',
      reason: err instanceof Error ? err.message : String(err),
    }
  }

  const minTurns = opts.config.minUserTurns ?? 2
  const minChars = opts.config.minUserChars ?? 80
  if (!transcriptMeetsMinContent(messages, minTurns, minChars)) {
    return { status: 'skipped', reason: 'min_content' }
  }

  const transcript = buildPhase1Transcript(messages)
  if (!transcript.trim()) {
    return { status: 'skipped', reason: 'empty_transcript' }
  }

  const now = opts.now ?? Date.now()
  const stage1Id = randomUUID()

  let projectKey: string | undefined
  let projectKeyHash: string | undefined
  const cwd = opts.sessionConfig?.cwd
  if (cwd) {
    try {
      const pk = resolveProjectKey(cwd)
      projectKey = pk.projectKey
      projectKeyHash = pk.projectKeyHash
    } catch {
      // best-effort project key
    }
  }

  try {
    const raw = await opts.llm.completeJson(
      PHASE1_SYSTEM_PROMPT,
      buildPhase1UserPrompt(transcript),
      {
        model: opts.config.extractModel,
        maxTokens: opts.config.extractMaxTokens ?? 4096,
        temperature: 0,
        timeoutMs: 120_000,
      },
    )
    const parsed = asStage1Output(raw)
    const rawMemory = redactSecrets(parsed.raw_memory ?? '')
    const rolloutSummary = redactSecrets(parsed.rollout_summary ?? '')
    const rolloutSlugRaw = parsed.rollout_slug?.trim()
    const rolloutSlug = rolloutSlugRaw ? redactSecrets(rolloutSlugRaw) : undefined

    const empty = !rawMemory.trim() && !rolloutSummary.trim()
    const status: Phase1ExtractStatus = empty ? 'succeeded_no_output' : 'succeeded'

    opts.store.upsertStage1({
      id: stage1Id,
      sessionId: opts.sessionId,
      projectKey,
      projectKeyHash,
      cwd,
      rawMemory,
      rolloutSummary,
      rolloutSlug,
      status,
      sourceUpdatedAt: now,
      createdAt: now,
    })

    return { status, stage1Id }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    try {
      opts.store.upsertStage1({
        id: stage1Id,
        sessionId: opts.sessionId,
        projectKey,
        projectKeyHash,
        cwd,
        rawMemory: '',
        rolloutSummary: '',
        status: 'failed',
        retryAfter: now + 60 * 60 * 1000,
        sourceUpdatedAt: now,
        createdAt: now,
      })
    } catch {
      // ignore secondary persist failure
    }
    return { status: 'failed', reason, stage1Id }
  }
}
