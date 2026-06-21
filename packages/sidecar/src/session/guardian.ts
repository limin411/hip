import { HumanMessage, SystemMessage, type AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'

// ── Public types ─────────────────────────────────────────────────────────────

/** The guardian's verdict on a tool execution request. */
export interface GuardianReview {
  /** 'allow' → proceed with execution; 'deny' → block and return reasoning to the agent. */
  decision: 'allow' | 'deny'
  /** Human-readable explanation; surfaced to the agent when denied, logged when allowed. */
  reasoning: string
  /** Model self-reported confidence, clamped to [0, 1]. Fail-open reviews report 0. */
  confidence: number
}

/** Input to GuardianReviewer.review(). */
export interface GuardianReviewInput {
  toolName: string
  toolInput: Record<string, unknown>
  /** Risk classification from ToolPolicy — included verbatim in the prompt. */
  riskLevel: 'low' | 'medium' | 'high'
  /** Optional recent-conversation summary for context. */
  context?: string
}

/** Constructor options. */
export interface GuardianReviewerOpts {
  /** The same ModelRunner the session uses — guardian runs a separate, lightweight call. */
  modelRunner: ModelRunner
  /**
   * Cap on the review response length, surfaced to the model as a prompt directive.
   * The ModelRunner interface does not currently expose per-call max_tokens, so this
   * is enforced via prompt guidance; the actual hard cap is set on the ChatOpenAI model
   * when the runner is constructed. Default: 200.
   */
  maxTokens?: number
}

// ── Fail-open sentinel ───────────────────────────────────────────────────────

/**
 * Returned whenever the guardian cannot reach a confident verdict — model threw,
 * returned malformed JSON, or produced an unparseable shape. Fail-open per the
 * task spec: a missing guardian must NOT block tool execution.
 */
export const FAIL_OPEN_REVIEW: GuardianReview = Object.freeze({
  decision: 'allow',
  reasoning: 'guardian unavailable — fail-open',
  confidence: 0,
})

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_TOKENS = 200

const SYSTEM_PROMPT =
  'You are a security guardian reviewing a tool execution request. ' +
  'Analyze the request for potential security risks: could it damage the ' +
 "user's system, expose sensitive data, is it reversible, is the scope " +
  'appropriate? Respond with ONLY a JSON object of the exact shape: ' +
  '{"decision": "allow" | "deny", "reasoning": "...", "confidence": 0.0-1.0}. ' +
  'No prose, no markdown fences.'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build the human-turn prompt that carries the specifics of one tool call. */
function buildReviewPrompt(input: GuardianReviewInput, maxTokens: number): string {
  const toolInputJson = safeStringify(input.toolInput)
  const contextLine = input.context ? `\nContext: ${input.context}` : ''
  return (
    `Tool: ${input.toolName}\n` +
    `Risk: ${input.riskLevel}\n` +
    `Input: ${toolInputJson}${contextLine}\n\n` +
    `Keep your response under ${maxTokens} tokens. ` +
    'Respond with the JSON object only.'
  )
}

/** JSON.stringify that never throws — guardian must fail-open, not crash. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return '{}'
  }
}

/**
 * Pull a plain-text string out of an AIMessage's content.
 * LangChain messages can hold either a plain string or an array of typed blocks.
 */
function extractMessageText(message: AIMessage): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block
        const typed = block as { type?: string; text?: unknown }
        return typed.type === 'text' && typeof typed.text === 'string' ? typed.text : ''
      })
      .join('')
  }
  return ''
}

/**
 * Parse the guardian's JSON verdict out of a model response.
 *
 * Tolerates markdown fences (```json … ```) and surrounding prose by scanning
 * for the outermost balanced `{ ... }` pair before falling back to a raw parse.
 * Returns undefined on any failure — the caller fail-opens.
 */
function parseReview(text: string): GuardianReview | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined

  // 1. ```json … ``` or ``` … ``` fenced block.
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/i)
  if (fenceMatch?.[1]) {
    const parsed = tryJson(fenceMatch[1].trim())
    if (parsed) return coerceReview(parsed)
  }

  // 2. Outermost { ... } pair (handles prose-wrapped JSON).
  const braceMatch = trimmed.match(/\{[\s\S]*\}/)
  if (braceMatch) {
    const parsed = tryJson(braceMatch[0])
    if (parsed) return coerceReview(parsed)
  }

  // 3. Raw parse (best effort).
  const parsed = tryJson(trimmed)
  if (parsed) return coerceReview(parsed)

  return undefined
}

function tryJson(s: string): unknown | undefined {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

/**
 * Validate the parsed object's shape and clamp the confidence.
 * Returns undefined when the shape is not a valid GuardianReview.
 */
function coerceReview(value: unknown): GuardianReview | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const obj = value as Record<string, unknown>

  const { decision, reasoning, confidence } = obj
  if (decision !== 'allow' && decision !== 'deny') return undefined
  if (typeof reasoning !== 'string' || reasoning.length === 0) return undefined
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return undefined

  return {
    decision,
    reasoning,
    confidence: clamp(confidence, 0, 1),
  }
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min
  if (n > max) return max
  return n
}

// ── GuardianReviewer ─────────────────────────────────────────────────────────

/**
 * Spawns a separate, lightweight model pass that reviews a high-risk tool
 * execution request BEFORE the tool runs.
 *
 * Contract:
 *  - Fail-open. Any model error, parse error, or shape violation returns
 *    {@link FAIL_OPEN_REVIEW} (decision='allow'). The guardian is a safety
 *    signal, not a hard gate; an unreachable guardian must never block work.
 *  - No risk filtering. The caller (ToolRunner) is responsible for invoking
 *    review() ONLY when riskLevel === 'high'. Low/medium tools bypass.
 *  - Non-interactive. Review is automatic; no HITL.
 *  - Separate model call. Uses the session's ModelRunner with bindTools=false
 *    and a tight maxTokens hint, so the review is fast and cheap.
 */
export class GuardianReviewer {
  private readonly maxTokens: number

  constructor(opts: GuardianReviewerOpts) {
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS
    this.modelRunner = opts.modelRunner
  }

  private readonly modelRunner: ModelRunner

  async review(input: GuardianReviewInput): Promise<GuardianReview> {
    const messages: BaseMessage[] = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(buildReviewPrompt(input, this.maxTokens)),
    ]

    const opts: ModelRunOptions = {
      tools: [],
      bindTools: false,
      onText: () => {
        // Streaming deltas are accumulated via the returned AIMessage (see below);
        // onText is wired but not needed for correctness.
      },
      onReasoning: () => {
        // Guardian review is non-reasoning; swallow any reasoning deltas.
      },
    }

    let response: AIMessage
    try {
      response = await this.modelRunner.run(messages, opts)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[GuardianReviewer] model runner threw — fail-open: ${msg}`)
      return FAIL_OPEN_REVIEW
    }

    const text = extractMessageText(response)
    const parsed = parseReview(text)
    if (!parsed) {
      const preview = text.length > 120 ? text.slice(0, 120) + '…' : text
      console.warn(`[GuardianReviewer] unparseable review response — fail-open. response="${preview}"`)
      return FAIL_OPEN_REVIEW
    }

    return parsed
  }
}
