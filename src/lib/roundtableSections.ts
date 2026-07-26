/**
 * Parse roundtable assistant markdown into foldable sections.
 * Matches headings produced by sidecar render.ts (en / zh / ja / ko).
 */

export type RoundtableSectionKind = 'plan' | 'round' | 'stage' | 'decision' | 'other' | 'normal'

export interface RoundtableSection {
  kind: RoundtableSectionKind
  /** Full heading line without leading ## */
  title: string
  body: string
  /** Round number when kind is round or stage */
  round?: number
  /** Default collapsed for long rounds when many sections */
  defaultOpen: boolean
}

const PLAN_RE = /^(#{1,3})\s*(会议规划|會議規劃|Meeting plan|会議計画|회의 계획)\s*$/i
const ROUND_RE =
  /^(#{1,3})\s*(?:第\s*(\d+)\s*轮|第\s*(\d+)\s*輪|Round\s+(\d+)|ラウンド\s*(\d+)|라운드\s*(\d+))\s*[—–-]?\s*(.*)$/i
const STAGE_RE =
  /^(#{1,3})\s*(阶段性结论|階段性結論|Stage conclusion|段階結論|단계 결론).*$/i
const DECISION_RE =
  /^(#{1,3})\s*(决策|決策|Decision|決定|결정).*$/i

/** True when content looks like a convened roundtable transcript. */
export function looksLikeRoundtableTranscript(content: string): boolean {
  if (!content.trim()) return false
  return (
    PLAN_RE.test(firstHeading(content) ?? '') ||
    /阶段性结论|Stage conclusion|段階結論|단계 결론|会议规划|Meeting plan/i.test(content)
  )
}

function firstHeading(content: string): string | null {
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (/^#{1,3}\s+\S/.test(t)) return t.replace(/^#{1,3}\s+/, '')
  }
  return null
}

export function parseRoundtableSections(content: string): RoundtableSection[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const sections: RoundtableSection[] = []
  let cur: RoundtableSection | null = null

  const flush = () => {
    if (cur) {
      cur.body = cur.body.replace(/^\n+|\n+$/g, '')
      sections.push(cur)
      cur = null
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      const title = heading[2]!.trim()
      flush()
      if (PLAN_RE.test(trimmed)) {
        cur = { kind: 'plan', title, body: '', defaultOpen: true }
      } else {
        const rm = trimmed.match(ROUND_RE)
        if (rm) {
          const n = Number(rm[2] || rm[3] || rm[4] || rm[5] || rm[6] || 0) || undefined
          cur = {
            kind: 'round',
            title,
            body: '',
            round: n,
            defaultOpen: true,
          }
        } else if (STAGE_RE.test(trimmed)) {
          cur = { kind: 'stage', title, body: '', defaultOpen: true }
        } else if (DECISION_RE.test(trimmed)) {
          cur = { kind: 'decision', title, body: '', defaultOpen: true }
        } else {
          cur = { kind: 'other', title, body: '', defaultOpen: true }
        }
      }
      continue
    }
    if (!cur) {
      cur = { kind: 'other', title: '', body: line, defaultOpen: true }
    } else {
      cur.body = cur.body ? `${cur.body}\n${line}` : line
    }
  }
  flush()

  // Collapse early rounds when many round sections exist
  const roundCount = sections.filter((s) => s.kind === 'round').length
  if (roundCount >= 3) {
    let seen = 0
    for (const s of sections) {
      if (s.kind === 'round') {
        seen++
        // keep last round open by default
        s.defaultOpen = seen === roundCount
      }
      if (s.kind === 'stage') {
        s.defaultOpen = true
      }
    }
  }

  return sections.length ? sections : [{ kind: 'normal', title: '', body: content, defaultOpen: true }]
}

/** Live status key for i18n while streaming (best-effort from partial content). */
export function deriveRoundtableStatusKey(
  content: string,
  streaming: boolean,
):
  | 'routing'
  | 'planning'
  | 'round'
  | 'stage'
  | 'deciding'
  | 'done'
  | null {
  if (!streaming && !looksLikeRoundtableTranscript(content)) return null
  if (!content.trim()) return streaming ? 'routing' : null
  if (/决策|Decision|決定|결정/i.test(content) && !streaming) return 'done'
  if (/决策|Decision|決定|결정/i.test(content) && streaming) return 'deciding'
  if (/阶段性结论|Stage conclusion|段階結論|단계 결론/i.test(content)) {
    return streaming ? 'stage' : 'stage'
  }
  if (/第\s*\d+\s*轮|Round\s+\d+|ラウンド|라운드/i.test(content)) return 'round'
  if (/会议规划|Meeting plan|会議計画|회의 계획/i.test(content)) return 'planning'
  if (/召开|Convening|円卓|원탁/i.test(content)) return 'planning'
  return streaming ? 'routing' : null
}

export function deriveRoundtableRoundNumber(content: string): number | undefined {
  // zh-CN 轮 / zh-TW 輪 / en Round / ja ラウンド / ko 라운드
  const matches = [
    ...content.matchAll(
      /第\s*(\d+)\s*轮|第\s*(\d+)\s*輪|Round\s+(\d+)|ラウンド\s*(\d+)|라운드\s*(\d+)/gi,
    ),
  ]
  if (!matches.length) return undefined
  const last = matches[matches.length - 1]!
  const n = Number(last[1] || last[2] || last[3] || last[4] || last[5])
  return Number.isFinite(n) ? n : undefined
}
