/**
 * Client helpers for LLM-enriched empty-state greetings.
 * Always-on: rule-based text first, then optional LLM replace when available.
 */

import type { EmptyGreetingGenerateContext, MemoryItem, MemoryKind } from '@hip/protocol'
import type { EmptyGreetingPick } from './emptyGreeting'

export const GREETING_TITLE_MAX = 40
export const GREETING_SUB_MAX = 80

const CACHE_KEY = 'hip-empty-greeting-llm-cache'
const CACHE_CAP = 24

/** Kinds that make warm greetings without dumping project secrets. */
const GREETING_MEMORY_KINDS = new Set<MemoryKind>([
  'preference',
  'profile',
  'lesson',
  'workflow',
])

export type LlmGreetingPair = { title: string; sub: string }

export type LlmGreetingCacheEntry = LlmGreetingPair & {
  cacheKey: string
  savedAt: number
  /** When set, entry is ignored after this time (timely night/week-edge cache). */
  expiresAt?: number
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Validate model-produced strings; reject empty / overlong / control junk. */
export function validateLlmGreeting(pair: {
  title?: string
  sub?: string
}): LlmGreetingPair | null {
  if (typeof pair.title !== 'string' || typeof pair.sub !== 'string') return null
  const title = collapseWs(pair.title)
  const sub = collapseWs(pair.sub)
  if (!title || !sub) return null
  if (title.length > GREETING_TITLE_MAX || sub.length > GREETING_SUB_MAX) return null
  // Reject multi-line dumps or prompt leaks.
  if (title.includes('\n') || sub.includes('\n')) return null
  if (/^\s*\{/.test(title) || /system prompt/i.test(title)) return null
  return { title, sub }
}

/**
 * Cache key is intentionally time-bucketed so evening ≠ late night ≠ Monday dawn.
 * `timeBucket` should be `timeCacheBucket(parts, weekEdge)` (day@hour|weekEdge).
 */
export function llmGreetingCacheKey(input: {
  /** day@hour|weekEdge — invalidates every local hour and week-edge shift */
  timeBucket: string
  language: string
  region: string
  surface: string
  tier: string
  timeOfDay: string
  modelKey: string
  holidayId?: string
  /** Short fingerprint of memory hints so new memories refresh copy. */
  memoryFp?: string
}): string {
  return [
    input.timeBucket,
    input.language,
    input.region,
    input.surface,
    input.tier,
    input.timeOfDay,
    input.modelKey || 'default',
    input.holidayId ?? '',
    input.memoryFp ?? '',
  ].join('|')
}

/** Night / week-edge slots expire faster so copy stays timely. */
export function llmGreetingCacheTtlMs(timeOfDay: string, weekEdge: string): number {
  if (weekEdge !== 'none' && weekEdge) return 30 * 60 * 1000 // 30m around Mon transition
  if (timeOfDay === 'lateNight' || timeOfDay === 'deepNight' || timeOfDay === 'lateEvening') {
    return 45 * 60 * 1000
  }
  return 2 * 60 * 60 * 1000 // 2h daytime
}

export type LlmGreetingCacheEntryV2 = LlmGreetingPair & {
  cacheKey: string
  savedAt: number
  expiresAt: number
}

function readCacheMap(): LlmGreetingCacheEntry[] {
  try {
    if (typeof sessionStorage === 'undefined') return []
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is LlmGreetingCacheEntry =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as LlmGreetingCacheEntry).cacheKey === 'string' &&
        typeof (e as LlmGreetingCacheEntry).title === 'string' &&
        typeof (e as LlmGreetingCacheEntry).sub === 'string',
    )
  } catch {
    return []
  }
}

export function readLlmGreetingCache(
  cacheKey: string,
  nowMs: number = Date.now(),
): LlmGreetingPair | null {
  const hit = readCacheMap().find((e) => e.cacheKey === cacheKey)
  if (!hit) return null
  if (typeof hit.expiresAt === 'number' && hit.expiresAt <= nowMs) return null
  return validateLlmGreeting(hit)
}

export function writeLlmGreetingCache(
  cacheKey: string,
  pair: LlmGreetingPair,
  opts?: { ttlMs?: number; nowMs?: number },
): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    const nowMs = opts?.nowMs ?? Date.now()
    const ttlMs = opts?.ttlMs ?? 2 * 60 * 60 * 1000
    const entry: LlmGreetingCacheEntry = {
      cacheKey,
      title: pair.title,
      sub: pair.sub,
      savedAt: nowMs,
      expiresAt: nowMs + ttlMs,
    }
    const next: LlmGreetingCacheEntry[] = [
      entry,
      ...readCacheMap().filter((e) => e.cacheKey !== cacheKey),
    ].slice(0, CACHE_CAP)
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(next))
  } catch {
    // private mode
  }
}

/** Human-readable tone brief for the LLM (English; model still writes in UI language). */
export function buildToneHint(input: {
  timeOfDay: string
  localHour: number
  weekday: number
  weekEdge: string
}): string {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const day = dayNames[input.weekday] ?? 'weekday'
  if (input.weekEdge === 'sunday-evening') {
    return `Sunday evening (~${input.localHour}:00). Weekend is ending; Monday is close. Gentle, not anxious; optional light "new week soon" energy.`
  }
  if (input.weekEdge === 'sunday-late') {
    return `Sunday late night (~${input.localHour}:00), almost Monday. Quiet companion tone; acknowledge the late hour without shaming; soft nod that a new week is minutes/hours away.`
  }
  if (input.weekEdge === 'monday-early') {
    return `Monday early hours (~${input.localHour}:00), start of the week before dawn. Calm "new week, no rush" energy; never corporate Monday-hype.`
  }
  switch (input.timeOfDay) {
    case 'earlyMorning':
      return `Early morning on ${day} (~${input.localHour}:00). Soft start-of-day energy.`
    case 'morning':
      return `Morning on ${day} (~${input.localHour}:00). Fresh, ready.`
    case 'afternoon':
      return `Afternoon on ${day} (~${input.localHour}:00). Steady mid-day focus.`
    case 'evening':
      return `Evening on ${day} (~${input.localHour}:00). Unwind-or-finish-one-thing vibe.`
    case 'lateEvening':
      return `Late evening on ${day} (~${input.localHour}:00). Still building is fine; keep it light.`
    case 'lateNight':
      return `Late night on ${day} (~${input.localHour}:00). Quiet co-pilot; no sleep lectures.`
    case 'deepNight':
      return `Deep night on ${day} (~${input.localHour}:00). Ultra-gentle; optional "small win only" energy.`
    default:
      return `${day} around ${input.localHour}:00.`
  }
}

/** Sanitize session titles for prompt context (no paths / overlong). */
export function sanitizeSessionTitlesForGreeting(titles: string[], limit = 3): string[] {
  const out: string[] = []
  for (const raw of titles) {
    let t = collapseWs(raw)
    if (!t) continue
    // Drop default placeholders
    if (t === '新对话' || t === 'New conversation' || t === '新對話') continue
    // Avoid absolute paths as titles
    if (t.startsWith('/') || /^[A-Za-z]:\\/.test(t)) continue
    if (t.length > 48) t = `${t.slice(0, 45)}…`
    out.push(t)
    if (out.length >= limit) break
  }
  return out
}

const SECRETISH =
  /(api[_-]?key|secret|token|password|passwd|credential|private[_-]?key|sk-[a-z0-9]|bearer\s)/i

function kindRank(kind: MemoryKind): number {
  switch (kind) {
    case 'preference':
      return 0
    case 'profile':
      return 1
    case 'lesson':
      return 2
    case 'workflow':
      return 3
    default:
      return 9
  }
}

/**
 * Turn MemoryItems into short, safe one-liners for greeting prompts.
 * Global preference/profile/lesson only; strips secret-looking content.
 */
export function sanitizeMemoryHintsForGreeting(
  items: readonly MemoryItem[],
  limit = 3,
): string[] {
  const ranked = items
    .filter((it) => it.status === 'active' || it.status === undefined)
    .filter((it) => it.scope === 'global' || it.scope === 'project')
    .filter((it) => GREETING_MEMORY_KINDS.has(it.kind))
    .slice()
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      const kr = kindRank(a.kind) - kindRank(b.kind)
      if (kr !== 0) return kr
      const la = a.lastUsedAt ?? a.updatedAt ?? 0
      const lb = b.lastUsedAt ?? b.updatedAt ?? 0
      return lb - la
    })

  const out: string[] = []
  for (const it of ranked) {
    const title = collapseWs(it.title ?? '')
    const body = collapseWs(it.content ?? '')
    const combined = title && body ? `${title}: ${body}` : title || body
    if (!combined) continue
    if (SECRETISH.test(combined)) continue
    if (combined.startsWith('/') || /^[A-Za-z]:\\/.test(combined)) continue
    // Keep hints punchy — model should not dump memory text into the UI.
    const hint = combined.length > 72 ? `${combined.slice(0, 69)}…` : combined
    out.push(hint)
    if (out.length >= limit) break
  }
  return out
}

/** Compact fingerprint so cache invalidates when memory set changes. */
export function memoryHintsFingerprint(hints: readonly string[]): string {
  if (hints.length === 0) return ''
  // Short stable hash — not crypto, just cache key salt.
  const s = hints.join('\u0001')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export function buildGenerateContext(input: {
  pick: EmptyGreetingPick
  baseTitle: string
  baseSub: string
  language: EmptyGreetingGenerateContext['language']
  surface: EmptyGreetingGenerateContext['surface']
  recentSessionTitles: string[]
  memoryHints?: string[]
}): EmptyGreetingGenerateContext {
  const holidayId =
    input.pick.tier === 'holiday' && input.pick.id.startsWith('holiday:')
      ? input.pick.id.slice('holiday:'.length)
      : undefined
  const memoryHints = (input.memoryHints ?? []).map(collapseWs).filter(Boolean).slice(0, 4)
  const weekEdge = input.pick.weekEdge ?? 'none'
  const toneHint = buildToneHint({
    timeOfDay: input.pick.timeOfDay,
    localHour: input.pick.localHour,
    weekday: input.pick.weekday,
    weekEdge,
  })
  return {
    language: input.language,
    surface: input.surface,
    timeOfDay: input.pick.timeOfDay,
    localHour: input.pick.localHour,
    weekday: input.pick.weekday,
    weekEdge,
    toneHint,
    region: input.pick.region,
    tier: input.pick.tier === 'default' ? 'timeOfDay' : input.pick.tier,
    baseTitle: input.baseTitle,
    baseSub: input.baseSub,
    ...(holidayId ? { holidayId } : {}),
    recentSessionTitles: sanitizeSessionTitlesForGreeting(input.recentSessionTitles),
    ...(memoryHints.length > 0 ? { memoryHints } : {}),
  }
}
