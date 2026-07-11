/**
 * Lightweight prompt-injection / instruction-override scanner for memory content.
 * Keep the list short but real. Do not import external Hermes.
 *
 * Returns an error message if blocked, null if OK.
 */

const BLOCKED_PATTERNS: { re: RegExp; label: string }[] = [
  {
    re: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
    label: 'ignore previous instructions',
  },
  {
    re: /disregard\s+(all\s+)?(previous|prior|above|system)\s+(instructions?|prompts?|rules?)/i,
    label: 'disregard previous instructions',
  },
  {
    re: /system\s*:\s*override/i,
    label: 'system: override',
  },
  {
    re: /\byou\s+are\s+now\b/i,
    label: 'you are now',
  },
  {
    re: /\b(do\s+not\s+follow|forget)\s+(your\s+)?(system\s+)?(prompt|instructions?)\b/i,
    label: 'forget system prompt',
  },
  {
    re: /\b(reveal|show|print|dump)\s+(your\s+)?(system\s+)?(prompt|instructions?)\b/i,
    label: 'reveal system prompt',
  },
  {
    re: /<\|?\s*im_start\s*\|?\s*>\s*system/i,
    label: 'im_start system marker',
  },
  {
    re: /\[INST\]\s*<<SYS>>/i,
    label: 'llama system override markers',
  },
]

export function scanMemoryContent(content: string): string | null {
  if (!content) return null
  for (const { re, label } of BLOCKED_PATTERNS) {
    if (re.test(content)) {
      return `memory content blocked by threat-scan (${label})`
    }
  }
  return null
}
