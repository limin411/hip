/**
 * One-shot empty-state greeting generation via built-in chat model (no tools / ACP).
 */
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { z } from 'zod'
import type { EmptyGreetingGenerateContext } from '@hip/protocol'
import { getActiveModel, resolveProviderBaseURL } from '../config/providers.js'
import { resolveApiKey } from '../config/auth-file.js'
import { buildChatModel } from './model-factory.js'

const TITLE_MAX = 40
const SUB_MAX = 80
const DEFAULT_TIMEOUT_MS = 2_500

const ResultSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX),
  sub: z.string().min(1).max(SUB_MAX),
})

export type EmptyGreetingGenerateInput = {
  providerID?: string
  modelID?: string
  context: EmptyGreetingGenerateContext
  /** Injectable for tests. */
  callLLM?: (system: string, user: string) => Promise<string>
  timeoutMs?: number
}

export type EmptyGreetingGenerateOk = {
  ok: true
  title: string
  sub: string
}

export type EmptyGreetingGenerateErr = {
  ok: false
  error: string
}

const SYSTEM_PROMPT = `You write the empty-state greeting under a mascot for hip, a desktop AI coding workbench.

Return ONLY a JSON object: {"title":"...","sub":"..."}
No markdown fences, no extra keys, no explanation.

Tone:
- Conversational and lightly playful — not corporate slogan, not stiff template
- Still professional enough for a coding workbench
- Sound like a sharp teammate, not a chatbot or marketer
- Honor toneHint and weekEdge carefully (Sunday night → Monday dawn needs softer, more specific lines)

Rules:
- title: short welcome line (max ${TITLE_MAX} characters)
- sub: one supporting line (max ${SUB_MAX} characters)
- Language MUST match the "language" field (zh-CN, zh-TW, or en)
- Do NOT copy baseTitle/baseSub verbatim; rephrase with fresh wording
- You MAY rephrase both title and subtitle, including holidays
- Use localHour + timeOfDay + weekEdge for nuance (lateEvening ≠ lateNight ≠ deepNight; sunday-late ≠ monday-early)
- For sunday-late / monday-early: acknowledge week transition lightly; never "crush Monday" corporate hype; never shame late hours
- recentSessionTitles: soft continuity only — never quote long titles or paths
- memoryHints: optional spice — at most ONE gentle nod if natural; never invent facts; never expose secrets
- If memoryHints are empty, still write lively time-specific copy
- Warm, never creepy; no sleep lectures; no religion proselytizing
- No emoji spam (0–1 emoji max, prefer none)`

function languageLabel(lang: EmptyGreetingGenerateContext['language']): string {
  if (lang === 'zh-CN') return 'Simplified Chinese (zh-CN)'
  if (lang === 'zh-TW') return 'Traditional Chinese (zh-TW)'
  return 'English (en)'
}

export function buildEmptyGreetingUserPrompt(ctx: EmptyGreetingGenerateContext): string {
  const recent = (ctx.recentSessionTitles ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 3)
  const memories = (ctx.memoryHints ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 4)
  return [
    `language: ${ctx.language} (${languageLabel(ctx.language)})`,
    `surface: ${ctx.surface}`,
    `timeOfDay: ${ctx.timeOfDay}`,
    typeof ctx.localHour === 'number' ? `localHour: ${ctx.localHour}` : null,
    typeof ctx.weekday === 'number' ? `weekday: ${ctx.weekday} (0=Sun…6=Sat)` : null,
    ctx.weekEdge ? `weekEdge: ${ctx.weekEdge}` : null,
    ctx.toneHint ? `toneHint: ${ctx.toneHint}` : null,
    `calendarRegion: ${ctx.region}`,
    `tier: ${ctx.tier}`,
    ctx.holidayId ? `holidayId: ${ctx.holidayId}` : null,
    `baseTitle: ${ctx.baseTitle}`,
    `baseSub: ${ctx.baseSub}`,
    recent.length > 0 ? `recentSessionTitles: ${JSON.stringify(recent)}` : 'recentSessionTitles: []',
    memories.length > 0
      ? `memoryHints (soft only, max one nod): ${JSON.stringify(memories)}`
      : 'memoryHints: []',
    'goal: fun, time-specific, non-generic empty-state copy',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Strip fences and parse JSON object. */
export function parseEmptyGreetingJson(raw: string): { title: string; sub: string } | null {
  let json = raw.trim()
  if (json.startsWith('```')) {
    const end = json.indexOf('\n')
    json = end >= 0 ? json.slice(end + 1).trim() : json.slice(3).trim()
    if (json.endsWith('```')) json = json.slice(0, -3).trim()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    const start = json.indexOf('{')
    const end = json.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      parsed = JSON.parse(json.slice(start, end + 1))
    } catch {
      return null
    }
  }
  const result = ResultSchema.safeParse(sanitizeParsed(parsed))
  if (!result.success) return null
  return result.data
}

function sanitizeParsed(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object') return parsed
  const o = parsed as Record<string, unknown>
  const title = typeof o.title === 'string' ? collapseWs(o.title) : o.title
  const sub = typeof o.sub === 'string' ? collapseWs(o.sub) : o.sub
  return { title, sub }
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function resolveChoice(providerID?: string, modelID?: string): {
  providerID: string
  modelID: string
  baseURL: string
} {
  const active = getActiveModel()
  const pid = (providerID?.trim() || active.providerID)
  const mid = (modelID?.trim() || active.modelID)
  return {
    providerID: pid,
    modelID: mid,
    baseURL: active.providerID === pid
      ? (active.baseURL || resolveProviderBaseURL(pid))
      : resolveProviderBaseURL(pid),
  }
}

async function defaultCallLLM(
  choice: { providerID: string; modelID: string; baseURL: string },
  system: string,
  user: string,
  timeoutMs: number,
): Promise<string> {
  if (!resolveApiKey(choice.providerID)) {
    throw new Error(`No API key for provider ${choice.providerID}`)
  }
  const model = buildChatModel(choice)
  const bound = model as {
    bind?: (p: Record<string, unknown>) => typeof model
    withConfig?: (p: Record<string, unknown>) => typeof model
    invoke: typeof model.invoke
  }
  const runnable =
    typeof bound.bind === 'function'
      ? bound.bind({ maxTokens: 120, temperature: 0.8 })
      : typeof bound.withConfig === 'function'
        ? bound.withConfig({ maxTokens: 120, temperature: 0.8 })
        : model

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await runnable.invoke(
      [new SystemMessage(system), new HumanMessage(user)],
      { signal: controller.signal },
    )
    const content = res?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .map((b) => {
          if (typeof b === 'string') return b
          if (b && typeof b === 'object' && 'text' in b) return String((b as { text: unknown }).text ?? '')
          return ''
        })
        .join('')
    }
    return content == null ? '' : String(content)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Generate empty-state title/sub via built-in model path.
 * Never creates a session or runs tools.
 */
export async function generateEmptyGreeting(
  input: EmptyGreetingGenerateInput,
): Promise<EmptyGreetingGenerateOk | EmptyGreetingGenerateErr> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const choice = resolveChoice(input.providerID, input.modelID)
  const user = buildEmptyGreetingUserPrompt(input.context)

  let raw: string
  try {
    const call =
      input.callLLM ??
      ((system: string, userPrompt: string) => defaultCallLLM(choice, system, userPrompt, timeoutMs))
    raw = await call(SYSTEM_PROMPT, user)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg || 'LLM call failed' }
  }

  const parsed = parseEmptyGreetingJson(raw)
  if (!parsed) {
    return { ok: false, error: 'Invalid greeting JSON from model' }
  }
  return { ok: true, title: parsed.title, sub: parsed.sub }
}
