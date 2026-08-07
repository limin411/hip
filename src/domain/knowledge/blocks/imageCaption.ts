/**
 * Image caption / width helpers (MD title syntax + BN previewWidth).
 */

import {
  parseImageMd,
  serializeImage,
  type ImageCaptionParts,
} from './carriers'

export type { ImageCaptionParts }

export function imagePartsFromMarkdown(md: string): ImageCaptionParts | null {
  return parseImageMd(md)
}

export function imageMarkdownFromParts(parts: ImageCaptionParts): string {
  return serializeImage(parts)
}

/** Default width when BN image has no previewWidth — 100% of content column. */
export const IMAGE_DEFAULT_WIDTH_PERCENT = 100

export const IMAGE_WIDTH_PRESETS = [25, 50, 75, 100] as const

export function clampImageWidthPercent(n: number): number {
  if (!Number.isFinite(n)) return IMAGE_DEFAULT_WIDTH_PERCENT
  return Math.min(100, Math.max(10, Math.round(n)))
}
