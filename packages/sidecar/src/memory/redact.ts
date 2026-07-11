const REDACTED = '[REDACTED_SECRET]'

/** OpenAI-style secret keys: sk-… */
const OPENAI_KEY = /\bsk-[A-Za-z0-9_-]{16,}\b/g

/** Authorization Bearer tokens (header or inline). */
const BEARER = /\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/gi

/** PEM private key blocks (RSA / EC / OPENSSH / generic). */
const PEM_PRIVATE_KEY =
  /-----BEGIN (?:[A-Z0-9 ]+)?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+)?PRIVATE KEY-----/g

/** Long hex digests/secrets (32+ hex chars, common for tokens/hashes). */
const LONG_HEX = /\b[a-fA-F0-9]{32,}\b/g

/** Common key=value secret assignments. */
const KEY_VALUE =
  /(?:api[_-]?key|password|secret|token|access[_-]?key)\s*[=:]\s*['"]?[^\s'",;]{6,}/gi

/**
 * Replace common secret patterns with `[REDACTED_SECRET]`.
 * Pure string transform — does not throw.
 */
export function redactSecrets(text: string): string {
  if (!text) return text
  return text
    .replace(PEM_PRIVATE_KEY, REDACTED)
    .replace(OPENAI_KEY, REDACTED)
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(KEY_VALUE, (m) => {
      const sep = m.includes('=') ? '=' : ':'
      const i = m.indexOf(sep)
      return `${m.slice(0, i + 1)}${REDACTED}`
    })
    .replace(LONG_HEX, REDACTED)
}
