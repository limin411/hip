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
 * Transform BN blocksToMarkdownLossy / external-HTML residue back to hip disk dialect.
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

/**
 * Minimal editor surface needed to serialize Live blocks to hip Markdown.
 * BN's `blocksToMarkdownLossy` strips custom-block toExternalHTML (math/mermaid/…)
 * down to bare text — so we export external HTML, protect hip carriers, then
 * re-use BN only for the remaining standard blocks.
 */
export type LiveMarkdownEditor = {
  // Parameter types are intentionally wide — BN's PartialBlock generics vary by schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blocksToHTMLLossy: (blocks?: any) => string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tryParseHTMLToBlocks: (html: string) => any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blocksToMarkdownLossy: (blocks?: any) => string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  document: any
}

const HIP_SLOT_RE = /%%HIP_SLOT_(\d+)%%/g

/**
 * Serialize the Live document to disk Markdown without losing hip dialect blocks.
 *
 * Probe-verified (BN 0.52.1):
 * - `blocksToMarkdownLossy` dumps math/mermaid/callout as bare text (no fences)
 * - `blocksToHTMLLossy` correctly emits `toExternalHTML` carriers
 * - BN `preprocessHTMLWhitespace` collapses newlines inside plain div text nodes
 *   (carriers therefore use data-src / data-body attributes)
 */
export function serializeLiveDocumentToMd(
  editor: LiveMarkdownEditor,
  blocks: unknown = editor.document,
): string {
  const html = editor.blocksToHTMLLossy(blocks)
  // Convert BN external style spans + hip carriers → dialect fragments, but
  // only for protected slots so the remaining HTML can still go through BN MD.
  const slots: string[] = []
  const protect = (fragment: string): string => {
    const i = slots.length
    // postSerialize also normalizes images; run full pipeline on each fragment.
    slots.push(postSerializeMdFromLive(fragment).replace(/\n+$/, ''))
    return `<p>%%HIP_SLOT_${i}%%</p>`
  }

  let protectedHtml = html

  // Block carriers (div data-hip-block=…) — including empty/self-closing forms
  protectedHtml = protectedHtml.replace(
    /<div\b[^>]*data-hip-block=["'][^"']+["'][^>]*(?:\/>|>[\s\S]*?<\/div>)/gi,
    (m) => protect(m),
  )

  // Inline wiki / math spans
  protectedHtml = protectedHtml.replace(
    /<span\b[^>]*data-hip-inline=["'][^"']+["'][^>]*>[\s\S]*?<\/span>/gi,
    (m) => {
      const i = slots.length
      slots.push(postSerializeMdFromLive(m).replace(/\n+$/, ''))
      // Inline placeholder must stay inline (not a block <p>)
      return `%%HIP_SLOT_${i}%%`
    },
  )

  // Highlight marks from BN external HTML
  protectedHtml = protectedHtml.replace(
    /<mark\b[^>]*data-hip-mark=["']highlight["'][^>]*>[\s\S]*?<\/mark>/gi,
    (m) => {
      const i = slots.length
      slots.push(postSerializeMdFromLive(m).replace(/\n+$/, ''))
      return `%%HIP_SLOT_${i}%%`
    },
  )

  // BN style color / background spans (before they get stripped by MD export)
  protectedHtml = protectedHtml.replace(
    /<span\b[^>]*data-style-type=["'](?:textColor|backgroundColor)["'][^>]*>[\s\S]*?<\/span>/gi,
    (m) => {
      const i = slots.length
      slots.push(postSerializeMdFromLive(m).replace(/\n+$/, ''))
      return `%%HIP_SLOT_${i}%%`
    },
  )

  // Remaining standard HTML → Markdown via BN
  const restBlocks = editor.tryParseHTMLToBlocks(protectedHtml)
  let md =
    restBlocks.length > 0
      ? editor.blocksToMarkdownLossy(restBlocks)
      : ''

  md = md.replace(HIP_SLOT_RE, (_full, n: string) => slots[Number(n)] ?? '')

  // Safety: any leftover carriers (e.g. if protection missed a form)
  return postSerializeMdFromLive(md)
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
