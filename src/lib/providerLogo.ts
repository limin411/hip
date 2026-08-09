import { invoke } from '@tauri-apps/api/core'

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

const localCache = new Map<string, Promise<string | null>>()

/**
 * Cached copy of a provider logo (data URL) served by the shell from
 * `~/.hip/cache/provider-logos/`; downloads once on first request and
 * re-serves the file offline. `null` = unavailable (offline / unsafe id) —
 * caller falls back to the CDN or the letter mark.
 */
export async function getCachedProviderLogo(providerId: string): Promise<string | null> {
  if (!shouldLoadProviderLogo({ id: providerId })) return null
  let p = localCache.get(providerId)
  if (!p) {
    p = invoke<string | null>('provider_logo', { providerId }).catch(() => null)
    localCache.set(providerId, p)
  }
  return p
}
