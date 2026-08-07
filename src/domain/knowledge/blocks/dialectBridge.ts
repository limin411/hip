/**
 * Pre/post Markdown bridge between disk dialect and BlockNote custom blocks.
 * Domain-only — no React.
 */

import {
  dialectToHtmlCarriers,
  htmlCarriersToDialect,
  serializeImage,
  parseImageMd,
} from './carriers'
import { DIALECT_PRESERVE_PROBES } from './fidelity'

/**
 * Transform disk/source MD body into a form BN tryParseMarkdownToBlocks can
 * map onto hip custom blocks (HTML carriers with data-hip-*).
 */
export function preParseMdForLive(body: string): string {
  return dialectToHtmlCarriers(body)
}

/**
 * Transform BN blocksToMarkdownLossy output back to hip disk dialect.
 * Also normalizes image title captions when present as bare HTML figures.
 */
export function postSerializeMdFromLive(md: string): string {
  let out = htmlCarriersToDialect(md)

  // BN sometimes emits ![alt](url) without title even when caption prop existed
  // if toExternalHTML used figure/figcaption — lift figcaption → title attr.
  out = out.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)\s*\n?(?:\*([^*]+)\*|<figcaption>([\s\S]*?)<\/figcaption>)/gi,
    (_full, alt: string, url: string, emCap?: string, figCap?: string) => {
      const caption = (emCap ?? figCap ?? '').replace(/<[^>]+>/g, '').trim()
      return serializeImage({ alt, url, caption })
    },
  )

  // Ensure image title syntax survives when already correct
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full) => {
    const parsed = parseImageMd(full)
    if (!parsed) return full
    return serializeImage(parsed)
  })

  return out
}

export type DialectLoss = { id: string; probe: RegExp }

/**
 * Compare original body markers vs serialized body.
 * Returns probes present in `before` that disappeared in `after`.
 */
export function detectDialectLoss(before: string, after: string): DialectLoss[] {
  const lost: DialectLoss[] = []
  for (const { id, probe } of DIALECT_PRESERVE_PROBES) {
    if (probe.test(before) && !probe.test(after)) {
      lost.push({ id, probe })
    }
  }
  return lost
}

/**
 * Full pure round-trip used by unit tests (no BN): dialect → HTML carriers → dialect.
 * Custom block NodeViews still need BN integration tests separately.
 */
export function carrierRoundTrip(md: string): string {
  return postSerializeMdFromLive(preParseMdForLive(md))
}
