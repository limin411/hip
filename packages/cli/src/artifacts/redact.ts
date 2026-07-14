/**
 * Redact env-like / secret-looking strings for harness traces (design K16).
 * Opt out with --trace-raw.
 */

const PATTERNS: RegExp[] = [
  // HIP_MODEL_*_API_KEY=... or "HIP_MODEL_...": "sk-..."
  /\bHIP_MODEL_[A-Z0-9_]+_API_KEY\b\s*[=:]\s*["']?[^\s"',}]+/gi,
  // common API key shapes
  /\bsk-[a-zA-Z0-9_-]{12,}\b/g,
  /\bsk-ant-[a-zA-Z0-9_-]{12,}\b/g,
  // Authorization: Bearer ...
  /\bBearer\s+[a-zA-Z0-9._\-+/=]{12,}/gi,
  // Generic api_key / apikey / secret in JSON-ish text
  /("?(?:api[_-]?key|apiKey|secret|token|password)"?\s*:\s*")([^"]{8,})(")/gi,
]

export function redactSecrets(text: string): string {
  let out = text
  for (const re of PATTERNS) {
    out = out.replace(re, (match, g1?: string, _g2?: string, g3?: string) => {
      // JSON-style capture groups
      if (typeof g1 === 'string' && typeof g3 === 'string') {
        return `${g1}***${g3}`
      }
      if (/^Bearer\s+/i.test(match)) return 'Bearer ***'
      if (match.includes('=')) {
        const i = match.indexOf('=')
        return match.slice(0, i + 1) + '***'
      }
      if (match.includes(':')) {
        const i = match.indexOf(':')
        return match.slice(0, i + 1) + ' ***'
      }
      return '***'
    })
  }
  return out
}
