import { createHash } from 'node:crypto'

/** Make a turnId / id safe to embed in a git ref path. Keep alnum/-/_ verbatim; if anything else
 *  appears (slash, dot, space, ~, CJK, …) fall back to a short deterministic sha1 so the ref is
 *  always valid (`git check-ref-format`-safe) and collision-resistant. */
export function sanitizeRefComponent(s: string): string {
  if (s.length > 0 && /^[A-Za-z0-9_-]+$/.test(s)) return s
  return 'h' + createHash('sha1').update(s).digest('hex').slice(0, 16)
}
