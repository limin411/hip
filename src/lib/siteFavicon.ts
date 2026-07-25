/**
 * Favicon URL candidates for a page (first-wins with onError cascade in UI).
 *
 * 1. Site-local `/favicon.ico` — no third-party tracker
 * 2. DuckDuckGo icons cache — better coverage when origin has no root favicon
 */
export function faviconCandidatesFor(pageUrl: string): string[] {
  try {
    const u = new URL(pageUrl)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return []
    const host = u.hostname
    if (!host) return []
    const out: string[] = []
    // Prefer https origin even when the page link was http (mixed content is fine for icons).
    const origin = `https://${host}`
    out.push(`${origin}/favicon.ico`)
    out.push(`https://icons.duckduckgo.com/ip3/${host}.ico`)
    return out
  } catch {
    return []
  }
}
