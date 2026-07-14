import {
  assetMarkdown,
  blobToBase64,
  isAllowedAssetMime,
  isDiskSizeOk,
  isInlineSizeOk,
  mimeFromFileName,
} from './assetUrl'
import { KNOWLEDGE_ASSET_INLINE_MAX_BYTES } from './limits'
import {
  knowledgeImportAssetBytes,
  knowledgeImportAssetFromPath,
  type KnowledgeAssetMeta,
} from '@/ipc/knowledge'

export type ImportAssetResult =
  | { ok: true; meta: KnowledgeAssetMeta; markdown: string }
  | { ok: false; reason: 'too_large_paste' | 'too_large_disk' | 'unsupported' | 'error'; message?: string }

/**
 * Portable absolute FS path detection for Tauri `File.path` / dialog paths.
 * Unix `/…`, Windows `C:\…` / `C:/…`, UNC `\\server\share…`.
 */
export function isAbsoluteFsPath(path: string): boolean {
  if (!path) return false
  if (path.startsWith('/')) return true
  if (path.startsWith('\\\\') || path.startsWith('//')) return true
  // Drive letter: C:\ or C:/
  return /^[A-Za-z]:[\\/]/.test(path)
}

/** Import from OS path (disk cap 25MB). */
export async function importAssetFromPath(
  spaceId: string,
  sourcePath: string,
): Promise<ImportAssetResult> {
  try {
    const meta = await knowledgeImportAssetFromPath(spaceId, sourcePath)
    const fileName = meta.relPath.split('/').pop() ?? 'file'
    return {
      ok: true,
      meta,
      markdown: assetMarkdown(meta.relPath, fileName, meta.mime),
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('max size') || message.includes('exceeds')) {
      return { ok: false, reason: 'too_large_disk', message }
    }
    if (message.includes('unsupported')) {
      return { ok: false, reason: 'unsupported', message }
    }
    return { ok: false, reason: 'error', message }
  }
}

/**
 * Import a browser File/Blob.
 * - Prefer path property when present (Tauri drop / path import, disk cap).
 * - Else base64 IPC when size ≤ inline max.
 * - Else too_large_paste (ask user to attach via file picker).
 */
export async function importAssetFromFile(
  spaceId: string,
  file: File,
): Promise<ImportAssetResult> {
  const path = (file as File & { path?: string }).path
  if (path && typeof path === 'string' && isAbsoluteFsPath(path)) {
    return importAssetFromPath(spaceId, path)
  }

  const mime =
    (file.type && isAllowedAssetMime(file.type) ? file.type : null) ??
    mimeFromFileName(file.name)
  if (!mime || !isAllowedAssetMime(mime)) {
    return { ok: false, reason: 'unsupported' }
  }
  if (!isInlineSizeOk(file.size)) {
    if (isDiskSizeOk(file.size)) {
      return { ok: false, reason: 'too_large_paste' }
    }
    return { ok: false, reason: 'too_large_disk' }
  }
  try {
    const base64 = await blobToBase64(file)
    const meta = await knowledgeImportAssetBytes(spaceId, {
      base64,
      fileName: file.name || `paste.${mime.split('/')[1] ?? 'bin'}`,
      mime,
    })
    const fileName = meta.relPath.split('/').pop() ?? file.name
    return {
      ok: true,
      meta,
      markdown: assetMarkdown(meta.relPath, fileName, meta.mime),
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('inline max') || message.includes(String(KNOWLEDGE_ASSET_INLINE_MAX_BYTES))) {
      return { ok: false, reason: 'too_large_paste', message }
    }
    if (message.includes('unsupported')) {
      return { ok: false, reason: 'unsupported', message }
    }
    return { ok: false, reason: 'error', message }
  }
}

/** Clipboard image items (paste). */
export async function importAssetFromClipboardItems(
  spaceId: string,
  items: DataTransferItemList | DataTransferItem[],
): Promise<ImportAssetResult | null> {
  const list = Array.from(items as DataTransferItem[])
  for (const item of list) {
    if (item.kind !== 'file') continue
    const type = item.type
    if (!type.startsWith('image/') || type === 'image/svg+xml') continue
    const file = item.getAsFile()
    if (!file) continue
    return importAssetFromFile(spaceId, file)
  }
  return null
}
