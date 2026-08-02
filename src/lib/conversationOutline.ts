import type { Message } from '@hip/protocol'
import { stripRoundtableFrame } from '@/lib/roundtable'

const LABEL_MAX = 72

/** First-line snippet for a user turn in the right-panel outline. */
export function userTurnLabel(message: Pick<Message, 'content' | 'attachments'>, index: number): string {
  // Wire content may include roundtable frame; outline must match bubble text.
  const text = stripRoundtableFrame(message.content ?? '').trim()
  if (text) {
    const first = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? text
    if (first.length > LABEL_MAX) return `${first.slice(0, LABEL_MAX)}…`
    return first
  }
  const names = (message.attachments ?? []).map((a) => a.name).filter(Boolean)
  if (names.length > 0) return names.join(', ')
  return `Turn ${index + 1}`
}

export interface UserTurnEntry {
  id: string
  index: number
  label: string
  timestamp?: number
}

/** User messages only, chronological — one outline row per send. */
export function collectUserTurns(messages: readonly Message[]): UserTurnEntry[] {
  const out: UserTurnEntry[] = []
  for (const m of messages) {
    if (m.role !== 'user') continue
    const index = out.length
    out.push({
      id: m.id,
      index,
      label: userTurnLabel(m, index),
      timestamp: m.timestamp,
    })
  }
  return out
}
