/** Default logo base; keep in sync with models.dev hosting. */
export const DEFAULT_MODELS_LOGO_BASE = 'https://models.dev/logos'

/**
 * Absolute SVG URL for a catalog provider id.
 * Returns '' when id is empty or unsafe (path separators / traversal).
 */
export function providerLogoUrl(
  providerId: string,
  base: string = DEFAULT_MODELS_LOGO_BASE,
): string {
  const id = providerId.trim()
  if (!id || id.includes('/') || id.includes('..') || id.includes('\\')) {
    return ''
  }
  const root = base.replace(/\/$/, '')
  return `${root}/${encodeURIComponent(id)}.svg`
}

/**
 * Whether this provider should attempt a remote logo.
 * Single gate: custom skip + same validation as providerLogoUrl
 * (empty URL ⇒ no remote).
 */
export function shouldLoadProviderLogo(
  p: { id: string; custom?: boolean },
  base: string = DEFAULT_MODELS_LOGO_BASE,
): boolean {
  if (p.custom) return false
  return Boolean(providerLogoUrl(p.id, base))
}
