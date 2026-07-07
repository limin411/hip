/**
 * Minimal 5-field cron expression parser.
 *
 * Fields: minute (0-59), hour (0-23), dom (1-31), month (1-12), dow (0-7, 0/7 = Sunday).
 *
 * Supported syntax per field:
 *   - star            any value
 *   - N               exact value
 *   - N-M             inclusive range
 *   - N,M,O           list
 *   - star/N          step (every N)
 *   - N-M/S           step within a range
 *
 * No external dependencies.
 */

/** Parsed cron fields — each is a sorted array of integer values (1-31 for dom, etc.). */
export interface CronFields {
  minute: number[]
  hour: number[]
  dom: number[]
  month: number[]
  dow: number[]
}

/** Month name → number mapping (JAN=1, DEC=12). */
const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/** Day name → number mapping (SUN=0, SAT=6). */
const DAY_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

/**
 * Parse a single cron field string into an array of integer values.
 *
 * @param raw     The raw field string (e.g. star/5, 1-10, 1,3,5)
 * @param min     Minimum valid value (inclusive)
 * @param max     Maximum valid value (inclusive)
 * @param names   Optional name-value mapping for named constants (e.g. month names)
 */
export function parseField(
  raw: string,
  min: number,
  max: number,
  names?: Record<string, number>,
): number[] {
  const trimmed = raw.trim().toLowerCase()

  // Empty or wildcard
  if (!trimmed || trimmed === '*') return range(min, max)

  // Resolve name aliases
  const resolved = names?.[trimmed] !== undefined
    ? String(names[trimmed])
    : trimmed

  // Step: */N or N-M/S
  const stepMatch = resolved.match(/^(\*|(\d+)(?:-(\d+))?)\/(\d+)$/)
  if (stepMatch) {
    const step = parseInt(stepMatch[4], 10)
    if (step < 1) throw new Error(`Invalid step value: ${step}`)

    let start: number
    let end: number

    if (stepMatch[1] === '*') {
      start = min
      end = max
    } else if (stepMatch[3] !== undefined) {
      start = parseInt(stepMatch[2], 10)
      end = parseInt(stepMatch[3], 10)
    } else {
      // Single value with step — treat as value to max
      start = parseInt(stepMatch[2], 10)
      end = max
    }

    const result: number[] = []
    for (let v = start; v <= end; v += step) {
      if (v >= min && v <= max) result.push(v)
    }
    return result
  }

  // Comma-separated list
  const parts = trimmed.split(',')
  const values = new Set<number>()

  for (const part of parts) {
    const p = part.trim()
    if (!p) continue

    // Named value
    if (names?.[p] !== undefined) {
      values.add(names[p])
      continue
    }

    // Named value range: e.g. mon-fri, jan-mar
    const namedRangeMatch = p.match(/^([a-z]+)-([a-z]+)$/)
    if (namedRangeMatch && names) {
      const a = names[namedRangeMatch[1]]
      const b = names[namedRangeMatch[2]]
      if (a !== undefined && b !== undefined) {
        for (let v = Math.min(a, b); v <= Math.max(a, b); v++) {
          if (v >= min && v <= max) values.add(v)
        }
        continue
      }
    }

    // Range: N-M
    const rangeMatch = p.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const a = parseInt(rangeMatch[1], 10)
      const b = parseInt(rangeMatch[2], 10)
      for (let v = Math.min(a, b); v <= Math.max(a, b); v++) {
        if (v >= min && v <= max) values.add(v)
      }
      continue
    }

    // Single number
    const n = parseInt(p, 10)
    if (isNaN(n)) throw new Error(`Invalid cron field value: "${p}"`)
    if (n < min || n > max) throw new Error(`Value ${n} out of range [${min}, ${max}]`)
    values.add(n)
  }

  return [...values].sort((a, b) => a - b)
}

/** Helper: create an inclusive integer range. */
function range(min: number, max: number): number[] {
  const result: number[] = []
  for (let i = min; i <= max; i++) result.push(i)
  return result
}

/**
 * Parse a 5-field cron expression into structured fields.
 *
 * Expression fields in order: minute, hour, dom, month, dow.
 * Example: the expression 'star/5 9-17 star star 1-5' matches every 5 minutes,
 * 9AM-5PM, weekdays only.
 */
export function parseCron(cron: string): CronFields {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(
      `Cron expression must have exactly 5 fields, got ${parts.length}: "${cron}"`,
    )
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23, HOUR_NAMES),
    dom: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12, MONTH_NAMES),
    dow: parseField(parts[4], 0, 7, DAY_NAMES),
  }
}

// Hour names are not standard but support for symmetry
const HOUR_NAMES: Record<string, number> = {}

/**
 * Check whether a given Date matches a cron expression.
 *
 * The dom and dow fields follow the standard OR semantics: if both are
 * non-wildcard, a date matches if it satisfies EITHER field.
 */
export function matches(cron: string, date: Date): boolean {
  const fields = parseCron(cron)

  const m = date.getMonth() + 1 // month is 0-based in JS Date
  if (!fields.month.includes(m)) return false

  const d = date.getDate()
  const dw = date.getDay() // 0 = Sunday

  // In cron 0 and 7 both represent Sunday. Normalize: if dow=7 appears in
  // the parsed expression, treat it as equivalent to 0.
  const normalizedDow = dw === 0 ? 0 : dw
  const dowMatch = fields.dow.includes(normalizedDow) ||
    (normalizedDow === 0 && fields.dow.includes(7))
  const domMatch = fields.dom.includes(d)

  // If both dom and dow are non-wildcard (* = full range), OR them
  const domIsWild = fields.dom.length === 31
  const dowIsWild = fields.dow.length === 8 // 0-7

  if (domIsWild && dowIsWild) {
    // Both are wildcard — always matches (checked month above)
  } else if (domIsWild) {
    if (!dowMatch) return false
  } else if (dowIsWild) {
    if (!domMatch) return false
  } else {
    // Both are specific: OR semantics
    if (!domMatch && !dowMatch) return false
  }

  const h = date.getHours()
  if (!fields.hour.includes(h)) return false

  const min = date.getMinutes()
  if (!fields.minute.includes(min)) return false

  return true
}

/**
 * Calculate the next datetime matching a cron expression after a given time.
 *
 * The return value is the first point in time (at minute precision) after
 * the `from` date that satisfies the cron expression. Returns null if
 * no match can be found within a reasonable lookahead (approx 5 years).
 */
export function nextRun(cron: string, from: Date): Date | null {
  const fields = parseCron(cron)

  // Normalize month array: if wildcard, use full range for efficiency
  const months = fields.month.length === 12 ? null : fields.month
  const doms = fields.dom.length === 31 ? null : fields.dom
  const dows = fields.dow.length === 8 ? null : fields.dow
  const hours = fields.hour.length === 24 ? null : fields.hour
  const minutes = fields.minute.length === 60 ? null : fields.minute

  // Start from the next minute
  const candidate = roundUpToMinute(from)
  const maxIterations = 5_256_000 // ~10 years of minutes — safety limit

  for (let i = 0; i < maxIterations; i++) {
    const month = candidate.getMonth() + 1
    if (months && !months.includes(month)) {
      // Skip to next month, 1st day, 0th hour
      candidate.setMonth(candidate.getMonth() + 1)
      candidate.setDate(1)
      candidate.setHours(0, 0, 0, 0)
      continue
    }

    const day = candidate.getDate()
    const dow = candidate.getDay()
    const normalizedDow = dow === 0 ? 0 : dow

    // Standard dom/dow OR semantics
    const domSpecific = doms !== null
    const dowSpecific = dows !== null
    const domOk = !doms || doms.includes(day)
    const dowOk = !dows || dows.includes(normalizedDow) ||
      (normalizedDow === 0 && (dows?.includes(7) ?? false))

    let dayMismatch = false
    if (domSpecific && dowSpecific) {
      // Both specific: OR semantics — skip only if both fail
      dayMismatch = !domOk && !dowOk
    } else if (domSpecific) {
      // Only dom specific — the day of week is unrestricted but dom must match
      dayMismatch = !domOk
    } else if (dowSpecific) {
      // Only dow specific — the day of month is unrestricted but dow must match
      dayMismatch = !dowOk
    }
    // Both wildcard: always passes

    if (dayMismatch) {
      candidate.setDate(candidate.getDate() + 1)
      candidate.setHours(0, 0, 0, 0)
      continue
    }

    const hour = candidate.getHours()
    if (hours && !hours.includes(hour)) {
      // Skip to next hour
      candidate.setHours(candidate.getHours() + 1)
      candidate.setMinutes(0, 0, 0)
      continue
    }

    const minute = candidate.getMinutes()
    if (minutes && !minutes.includes(minute)) {
      // Skip to next minute
      candidate.setMinutes(candidate.getMinutes() + 1, 0, 0)
      continue
    }

    // All fields match
    return candidate
  }

  return null
}

/** Round a Date up to the next minute boundary (zero seconds, zero ms). */
function roundUpToMinute(d: Date): Date {
  const result = new Date(d)
  result.setSeconds(0, 0)
  if (result.getTime() <= d.getTime()) {
    result.setTime(result.getTime() + 60_000)
  }
  return result
}
