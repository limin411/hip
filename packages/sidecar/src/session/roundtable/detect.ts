import { ROUNDTABLE_MARKER, ROUNDTABLE_SEP, resolveRoundtableEngine } from './constants.js'
import type { RoundtableLang } from './types.js'

export function isRoundtableMessage(content: string): boolean {
  return typeof content === 'string' && content.startsWith(ROUNDTABLE_MARKER)
}

export function stripRoundtableFrame(content: string): string {
  if (!isRoundtableMessage(content)) return content
  const idx = content.indexOf(ROUNDTABLE_SEP)
  if (idx === -1) {
    const nl = content.indexOf('\n')
    return nl === -1 ? '' : content.slice(nl + 1).trimStart()
  }
  return content.slice(idx + ROUNDTABLE_SEP.length)
}

export function resolveRoundtableLang(language?: string | null): RoundtableLang {
  const raw = (language ?? 'en').trim()
  if (raw === 'zh-CN' || raw.startsWith('zh-CN')) return 'zh-CN'
  if (raw === 'zh-TW' || raw.startsWith('zh-TW') || raw === 'zh-HK') return 'zh-TW'
  if (raw === 'zh' || raw.startsWith('zh')) return 'zh-CN'
  if (raw === 'ja' || raw.startsWith('ja')) return 'ja'
  if (raw === 'ko' || raw.startsWith('ko')) return 'ko'
  return 'en'
}

/**
 * Whether this turn should enter RoundtableRunner (loop engine).
 * sim → false (caller keeps normal agent turn with framed prompt).
 */
export function shouldEnterRoundtableLoop(
  userContent: string,
  opts?: { surface?: string; engine?: ReturnType<typeof resolveRoundtableEngine> },
): boolean {
  if (!isRoundtableMessage(userContent)) return false
  // Roundtable product surface is Chat; if surface is code, still allow if framed
  // (marker only comes from Chat empty-state today).
  void opts?.surface
  const engine = opts?.engine ?? resolveRoundtableEngine()
  return engine === 'loop'
}
