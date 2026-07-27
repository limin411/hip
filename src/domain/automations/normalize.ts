import { isAutomationId, isAutomationRunId } from './ids'
import type {
  Automation,
  AutomationPermissionMode,
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTrigger,
  AutomationTrigger,
  AutomationsCatalogV1,
  AutomationRunsLogV1,
} from './types'

/** Name max length (JS string length). */
export const AUTOMATION_NAME_MAX = 200

/**
 * Prompt max size in **UTF-8 bytes** — 256 KiB.
 * Keeps catalog JSON bounded; still large enough for skill-seeded prompts.
 */
export const AUTOMATION_PROMPT_MAX = 256 * 1024

/** Max skill ids retained as UI metadata. */
export const AUTOMATION_SKILL_IDS_MAX = 20

const textEncoder = new TextEncoder()

const RUN_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'running',
  'waiting_user',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
])

const RUN_TRIGGERS: ReadonlySet<string> = new Set(['manual', 'schedule', 'catchup'])

const PERMISSION_MODES: ReadonlySet<string> = new Set(['chat', 'edit', 'full'])

export function utf8ByteLength(s: string): number {
  return textEncoder.encode(s).byteLength
}

/** Truncate to at most `maxBytes` UTF-8 bytes without splitting a code point. */
export function clampUtf8Bytes(s: string, maxBytes: number): string {
  if (s.length * 4 <= maxBytes) return s
  if (utf8ByteLength(s) <= maxBytes) return s
  let bytes = 0
  let out = ''
  for (const ch of s) {
    const n = textEncoder.encode(ch).byteLength
    if (bytes + n > maxBytes) break
    out += ch
    bytes += n
  }
  return out
}

function clampStr(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max)
}

function asFiniteNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function asOptionalFiniteNumber(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function clampHour(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(23, Math.max(0, Math.trunc(n)))
}

function clampMinute(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(59, Math.max(0, Math.trunc(n)))
}

function clampWeekday(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(6, Math.max(0, Math.trunc(n)))
}

/**
 * Coerce unknown trigger JSON into a valid AutomationTrigger.
 * Invalid shapes fall back to `{ kind: 'manual' }`.
 */
export function normalizeTrigger(raw: unknown): AutomationTrigger {
  if (!raw || typeof raw !== 'object') return { kind: 'manual' }
  const o = raw as Record<string, unknown>
  const kind = typeof o.kind === 'string' ? o.kind : ''

  if (kind === 'manual') return { kind: 'manual' }

  if (kind === 'daily') {
    return {
      kind: 'daily',
      hour: clampHour(asFiniteNumber(o.hour, 9)),
      minute: clampMinute(asFiniteNumber(o.minute, 0)),
    }
  }

  if (kind === 'weekly') {
    return {
      kind: 'weekly',
      weekday: clampWeekday(asFiniteNumber(o.weekday, 1)),
      hour: clampHour(asFiniteNumber(o.hour, 9)),
      minute: clampMinute(asFiniteNumber(o.minute, 0)),
    }
  }

  return { kind: 'manual' }
}

function normalizeRunStatus(raw: unknown): AutomationRunStatus {
  if (typeof raw === 'string' && RUN_STATUSES.has(raw)) {
    return raw as AutomationRunStatus
  }
  return 'pending'
}

function normalizeRunTrigger(raw: unknown): AutomationRunTrigger {
  if (typeof raw === 'string' && RUN_TRIGGERS.has(raw)) {
    return raw as AutomationRunTrigger
  }
  return 'manual'
}

function normalizePermissionMode(raw: unknown): AutomationPermissionMode | undefined {
  if (typeof raw === 'string' && PERMISSION_MODES.has(raw)) {
    return raw as AutomationPermissionMode
  }
  return undefined
}

function normalizeSkillIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of raw) {
    if (typeof t !== 'string') continue
    const id = t.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= AUTOMATION_SKILL_IDS_MAX) break
  }
  return out.length > 0 ? out : undefined
}

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim()
  return s || undefined
}

function normalizeOptionalPath(raw: unknown): string | null | undefined {
  if (raw === null) return null
  if (raw === undefined) return undefined
  if (typeof raw !== 'string') return undefined
  const s = raw.trim()
  return s || null
}

/**
 * Normalize one automation row. Returns null if id is invalid.
 */
export function normalizeAutomation(raw: unknown, fallbackNow: number = Date.now()): Automation | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const id = typeof o.id === 'string' ? o.id.trim() : ''
  if (!isAutomationId(id)) return null

  const name =
    typeof o.name === 'string' ? clampStr(o.name.trim(), AUTOMATION_NAME_MAX) : ''
  const prompt =
    typeof o.prompt === 'string' ? clampUtf8Bytes(o.prompt, AUTOMATION_PROMPT_MAX) : ''
  const enabled = o.enabled === true || o.enabled === false ? o.enabled : true
  const trigger = normalizeTrigger(o.trigger)
  const createdAt = asFiniteNumber(o.createdAt, fallbackNow)
  const updatedAt = asFiniteNumber(o.updatedAt, createdAt)

  const auto: Automation = {
    id,
    name,
    prompt,
    enabled,
    trigger,
    createdAt,
    updatedAt,
  }

  const projectPath = normalizeOptionalPath(o.projectPath)
  if (projectPath !== undefined) auto.projectPath = projectPath

  const llmProvider = normalizeOptionalString(o.llmProvider)
  if (llmProvider) auto.llmProvider = llmProvider
  const model = normalizeOptionalString(o.model)
  if (model) auto.model = model
  const agentId = normalizeOptionalString(o.agentId)
  if (agentId) auto.agentId = agentId
  const effort = normalizeOptionalString(o.effort)
  if (effort) auto.effort = effort

  const permissionMode = normalizePermissionMode(o.permissionMode)
  if (permissionMode) auto.permissionMode = permissionMode

  const skillIds = normalizeSkillIds(o.skillIds)
  if (skillIds) auto.skillIds = skillIds

  if (o.templateId === null) auto.templateId = null
  else {
    const templateId = normalizeOptionalString(o.templateId)
    if (templateId) auto.templateId = templateId
  }

  auto.lastRunAt = asOptionalFiniteNumber(o.lastRunAt)
  if (o.lastStatus == null || o.lastStatus === '') {
    auto.lastStatus = null
  } else {
    auto.lastStatus = normalizeRunStatus(o.lastStatus)
  }
  if (o.lastError == null || o.lastError === '') {
    auto.lastError = null
  } else if (typeof o.lastError === 'string') {
    auto.lastError = o.lastError
  } else {
    auto.lastError = null
  }
  if (o.lastSessionId == null || o.lastSessionId === '') {
    auto.lastSessionId = null
  } else if (typeof o.lastSessionId === 'string') {
    auto.lastSessionId = o.lastSessionId.trim() || null
  } else {
    auto.lastSessionId = null
  }
  auto.nextRunAt = asOptionalFiniteNumber(o.nextRunAt)

  return auto
}

/**
 * Normalize one run row. Returns null if id / automationId invalid.
 */
export function normalizeAutomationRun(raw: unknown, fallbackNow: number = Date.now()): AutomationRun | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const id = typeof o.id === 'string' ? o.id.trim() : ''
  if (!isAutomationRunId(id)) return null

  const automationId = typeof o.automationId === 'string' ? o.automationId.trim() : ''
  if (!isAutomationId(automationId)) return null

  const status = normalizeRunStatus(o.status)
  const trigger = normalizeRunTrigger(o.trigger)
  const startedAt = asFiniteNumber(o.startedAt, fallbackNow)

  const run: AutomationRun = {
    id,
    automationId,
    status,
    trigger,
    startedAt,
  }

  if (o.sessionId == null || o.sessionId === '') {
    run.sessionId = null
  } else if (typeof o.sessionId === 'string') {
    run.sessionId = o.sessionId.trim() || null
  } else {
    run.sessionId = null
  }

  run.finishedAt = asOptionalFiniteNumber(o.finishedAt)

  if (o.error == null || o.error === '') {
    run.error = null
  } else if (typeof o.error === 'string') {
    run.error = o.error
  } else {
    run.error = null
  }

  return run
}

export function emptyAutomationsCatalog(): AutomationsCatalogV1 {
  return { version: 1, automations: [] }
}

export function emptyAutomationRunsLog(): AutomationRunsLogV1 {
  return { version: 1, runs: [] }
}

/**
 * Coerce unknown disk/IPC payload into a valid catalog.
 * Drops invalid rows, clamps strings, dedupes by id (first wins).
 */
export function normalizeCatalog(raw: unknown): AutomationsCatalogV1 {
  const now = Date.now()
  if (!raw || typeof raw !== 'object') return emptyAutomationsCatalog()

  const o = raw as Record<string, unknown>
  const listIn = Array.isArray(o.automations) ? o.automations : []
  const automations: Automation[] = []
  const seen = new Set<string>()

  for (const entry of listIn) {
    const a = normalizeAutomation(entry, now)
    if (!a || seen.has(a.id)) continue
    seen.add(a.id)
    automations.push(a)
  }

  return { version: 1, automations }
}

/**
 * Coerce unknown disk/IPC payload into a valid runs log.
 * Drops invalid rows; dedupes by id (first wins). Does not truncate
 * (caller uses `truncateRuns` before save).
 */
export function normalizeRunsLog(raw: unknown): AutomationRunsLogV1 {
  const now = Date.now()
  if (!raw || typeof raw !== 'object') return emptyAutomationRunsLog()

  const o = raw as Record<string, unknown>
  const listIn = Array.isArray(o.runs) ? o.runs : []
  const runs: AutomationRun[] = []
  const seen = new Set<string>()

  for (const entry of listIn) {
    const r = normalizeAutomationRun(entry, now)
    if (!r || seen.has(r.id)) continue
    seen.add(r.id)
    runs.push(r)
  }

  return { version: 1, runs }
}
