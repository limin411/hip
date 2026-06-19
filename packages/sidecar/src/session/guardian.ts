import type { Hook } from '@hip/protocol'

/** Read-only tools that are always allowed through — no risk assessment needed. */
const READ_ONLY_TOOLS = new Set(['read_file', 'ls', 'glob', 'grep'])

/** Model contract: invoke with a prompt string and return something with content. */
export interface GuardianModel {
  invoke(input: string): Promise<{ content: unknown }>
}

type RiskLevel = 'low' | 'medium' | 'high'
type RiskCategory = 'data_exfiltration' | 'credential_probing' | 'security_weakening' | 'destructive' | 'none'

interface GuardianAssessment {
  risk: RiskLevel
  category: RiskCategory
  reason: string
}

interface GuardianState {
  consecutiveDenials: number
  mode: 'normal' | 'ask-all'
}

/**
 * Extract a text string from a LangChain-style model response.
 * Handles string content, array-of-blocks content, and falls back to JSON.stringify.
 */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text!)
      .join('')
  }
  return JSON.stringify(content)
}

/**
 * Parse the JSON assessment out of the model response.
 * Tolerates markdown fences and surrounding prose.
 */
function parseAssessment(text: string): GuardianAssessment {
  // 1. Extract from ```json ... ``` or ``` ... ``` fences
  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fence) return JSON.parse(fence[1].trim()) as GuardianAssessment

  // 2. Find outermost { ... } pair
  const brace = text.match(/\{[\s\S]*\}/)
  if (brace) return JSON.parse(brace[0]) as GuardianAssessment

  // 3. Raw parse (best-effort)
  return JSON.parse(text) as GuardianAssessment
}

function isRisk(v: unknown): v is RiskLevel {
  return v === 'low' || v === 'medium' || v === 'high'
}

function isCategory(v: unknown): v is RiskCategory {
  return (
    v === 'data_exfiltration' ||
    v === 'credential_probing' ||
    v === 'security_weakening' ||
    v === 'destructive' ||
    v === 'none'
  )
}

const ASSESSMENT_PROMPT = `Assess the risk of this tool execution. Tool: {name}, Input: {args}.
Classify risk: low/medium/high, category: data_exfiltration/credential_probing/security_weakening/destructive/none.
Return ONLY a JSON object: {"risk": "...", "category": "...", "reason": "brief explanation"}`

/**
 * Sanitize tool input before sending it to the Guardian LLM.
 * - Truncates string values longer than 500 characters
 * - Redacts values whose keys match credential patterns (api_key, token, secret, password, auth)
 * - Redacts values that look like AWS keys (AKIA…), JWT tokens (eyJ…), or GitHub tokens (ghp_…)
 * - Preserves field names/keys — only values are redacted
 */
export function sanitizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const credentialKeyPattern = /(api[_-]?key|token|secret|password|auth)/i
  const awsKeyPattern = /^AKIA[A-Z0-9]{16}$/
  const jwtPattern = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
  const githubTokenPattern = /^ghp_[A-Za-z0-9]{36,}$/

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      if (
        credentialKeyPattern.test(key) ||
        awsKeyPattern.test(value) ||
        jwtPattern.test(value) ||
        githubTokenPattern.test(value)
      ) {
        result[key] = '[REDACTED]'
      } else if (value.length > 500) {
        result[key] = value.slice(0, 500) + '…(truncated)'
      } else {
        result[key] = value
      }
    } else {
      result[key] = value
    }
  }
  return result
}

function buildPrompt(toolName: string, toolInput: Record<string, unknown>): string {
  return ASSESSMENT_PROMPT.replace('{name}', toolName).replace('{args}', JSON.stringify(sanitizeToolInput(toolInput)))
}

/**
 * Create a Guardian PreToolUse hook that auto-reviews every tool call via an LLM.
 *
 * The hook is NOT registered on Session by default — opt-in only (caller adds it manually).
 *
 * - Read-only tools (read_file, ls, glob, grep) are skipped.
 * - Low risk → allow, medium → ask (HITL confirmation), high → deny.
 * - Circuit breaker: after 3 consecutive denials the hook switches to "ask-all" mode
 *   (high→deny, medium→ask, low→allow) to prevent an infinite deny loop.
 */
export function createGuardianHook(model: GuardianModel): Hook {
  const state: GuardianState = { consecutiveDenials: 0, mode: 'normal' }

  return {
    event: 'PreToolUse',
    // No matcher — fires on every tool. Read-only tools are filtered inside the handler.
    handler: async (ctx) => {
      const toolName = ctx.toolName

      // Skip read-only tools and nameless invocations
      if (!toolName || READ_ONLY_TOOLS.has(toolName)) {
        return { kind: 'allow' }
      }

      // Ask the model for a risk assessment
      let assessment: GuardianAssessment
      try {
        const response = await model.invoke(buildPrompt(toolName, ctx.toolInput ?? {}))
        const text = extractText(response.content)
        assessment = parseAssessment(text)
      } catch {
        return { kind: 'deny', reason: '[Guardian] Model call or parse failed — fail-closed' }
      }

      // Validate the shape
      if (!isRisk(assessment.risk) || !isCategory(assessment.category) || typeof assessment.reason !== 'string') {
        return { kind: 'deny', reason: '[Guardian] Model returned unrecognised assessment shape' }
      }

      const reason = `[Guardian] ${assessment.category}: ${assessment.reason}`

      // ── Circuit breaker: ask-all mode ──
      if (state.mode === 'ask-all') {
        switch (assessment.risk) {
          case 'high':
            state.consecutiveDenials++
            return { kind: 'deny', reason }
          case 'medium':
            return { kind: 'ask', reason }
          case 'low':
            state.consecutiveDenials = 0
            return { kind: 'allow' }
        }
      }

      // ── Normal mode ──
      switch (assessment.risk) {
        case 'low':
          state.consecutiveDenials = 0
          return { kind: 'allow' }
        case 'medium':
          state.consecutiveDenials = 0
          return { kind: 'ask', reason }
        case 'high': {
          state.consecutiveDenials++
          if (state.consecutiveDenials >= 3) {
            state.mode = 'ask-all'
            return { kind: 'ask', reason: `${reason} (Circuit breaker: switched to ask-all mode)` }
          }
          return { kind: 'deny', reason }
        }
      }
    },
  }
}
