/**
 * Redact common secret-bearing patterns from an error/message before it is
 * sent to the client. This is a last-line-of-defense sanitizer; callers should
 * still avoid putting secrets in error messages in the first place.
 *
 * Currently covers:
 *   - OpenAI-style keys: sk-...
 *   - api_key / api-key / apiKey assignments
 *   - Bearer tokens
 */
export function safeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw
    .replace(/\b(sk-[a-zA-Z0-9\-]{20,})/g, '[REDACTED]')
    .replace(/\b([a-zA-Z0-9_-]*api[_-]?key[a-zA-Z0-9_-]*)\s*[:=]\s*["']?[a-zA-Z0-9_\-./+=]{16,}["']?/gi, '$1=[REDACTED]')
    .replace(/\b(bearer\s+[a-zA-Z0-9_\-./+=]{8,})/gi, '[REDACTED]')
}
