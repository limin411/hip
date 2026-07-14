import {
  KNOWLEDGE_ASSET_INLINE_MAX_BYTES,
  KNOWLEDGE_ASSET_MAX_BYTES,
} from './limits'
import {
  knowledgeReadAssetData,
  type KnowledgeAssetData,
} from '@/ipc/knowledge'

/** Session cache: `${spaceId}::${relPath}` → data URL (inlinable assets only). */
const dataUrlCache = new Map<string, string>()

export function cacheKey(spaceId: string, relPath: string): string {
  return `${spaceId}::${normalizeAssetRelPath(relPath)}`
}

/** Normalize MD src to space-root-relative `assets/…` form, or null if not a local asset. */
export function normalizeAssetRelPath(src: string): string | null {
  const raw = src.trim()
  if (!raw) return null
  if (
    raw.startsWith('data:') ||
    raw.startsWith('http://') ||
    raw.startsWith('https://') ||
    raw.startsWith('//') ||
    raw.startsWith('asset:') ||
    raw.startsWith('#')
  ) {
    return null
  }
  let path = raw.replace(/\\/g, '/')
  if (path.startsWith('./')) path = path.slice(2)
  // Only space-root-relative assets/… (design K8 / K16)
  if (path.startsWith('assets/')) {
    const rest = path.slice('assets/'.length)
    if (!rest || rest.includes('/') || rest.includes('..')) return null
    return `assets/${rest}`
  }
  return null
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/') && mime !== 'image/svg+xml'
}

export function clearAssetDataUrlCache(spaceId?: string): void {
  if (!spaceId) {
    dataUrlCache.clear()
    return
  }
  const prefix = `${spaceId}::`
  for (const k of dataUrlCache.keys()) {
    if (k.startsWith(prefix)) dataUrlCache.delete(k)
  }
}

/**
 * Resolve a local `assets/…` path to a `data:` URL for preview.
 * Returns null for oversize / missing / non-inlinable (caller shows placeholder).
 */
export async function resolveAssetDataUrl(
  spaceId: string,
  relPath: string,
  opts?: {
    read?: (spaceId: string, relPath: string) => Promise<KnowledgeAssetData>
  },
): Promise<{ dataUrl: string; mime: string } | null> {
  const norm = normalizeAssetRelPath(relPath)
  if (!norm) return null
  const key = cacheKey(spaceId, norm)
  const hit = dataUrlCache.get(key)
  if (hit) {
    const mime = hit.slice(5, hit.indexOf(';')) || 'application/octet-stream'
    return { dataUrl: hit, mime }
  }
  const read = opts?.read ?? knowledgeReadAssetData
  try {
    const { mime, base64 } = await read(spaceId, norm)
    const dataUrl = `data:${mime};base64,${base64}`
    dataUrlCache.set(key, dataUrl)
    return { dataUrl, mime }
  } catch {
    return null
  }
}

export function isInlineSizeOk(byteLength: number): boolean {
  return byteLength > 0 && byteLength <= KNOWLEDGE_ASSET_INLINE_MAX_BYTES
}

export function isDiskSizeOk(byteLength: number): boolean {
  return byteLength > 0 && byteLength <= KNOWLEDGE_ASSET_MAX_BYTES
}

/** Allowed MIME types for import (mirrors Rust allowlist). */
export const KNOWLEDGE_ASSET_MIME_ALLOWLIST = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
] as const

export function isAllowedAssetMime(mime: string): boolean {
  return (KNOWLEDGE_ASSET_MIME_ALLOWLIST as readonly string[]).includes(mime)
}

export function mimeFromFileName(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'pdf':
      return 'application/pdf'
    default:
      return null
  }
}

/** Build markdown image (or link for non-image) for an imported asset. */
export function assetMarkdown(relPath: string, fileName: string, mime: string): string {
  const alt = fileName.replace(/\.[^.]+$/, '') || 'asset'
  if (isImageMime(mime)) {
    return `![${alt}](${relPath})`
  }
  return `[${fileName}](${relPath})`
}

/** Read a Blob/File as base64 (no data: prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('expected data URL'))
        return
      }
      const i = result.indexOf(',')
      resolve(i >= 0 ? result.slice(i + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}
