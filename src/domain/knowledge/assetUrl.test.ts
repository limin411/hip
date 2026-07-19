import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  normalizeAssetRelPath,
  resolveAssetDataUrl,
  clearAssetDataUrlCache,
  assetMarkdown,
  isInlineSizeOk,
  isAllowedAssetMime,
  mimeFromFileName,
} from './assetUrl'
import { KNOWLEDGE_ASSET_INLINE_MAX_BYTES } from './limits'

beforeEach(() => {
  clearAssetDataUrlCache()
})

describe('normalizeAssetRelPath', () => {
  it('accepts space-root-relative assets paths', () => {
    expect(normalizeAssetRelPath('assets/ast_x_a.png')).toBe('assets/ast_x_a.png')
    expect(normalizeAssetRelPath('./assets/ast_x_a.png')).toBe('assets/ast_x_a.png')
  })

  it('rejects remote, data, and traversal', () => {
    expect(normalizeAssetRelPath('https://x/a.png')).toBeNull()
    expect(normalizeAssetRelPath('data:image/png;base64,xx')).toBeNull()
    expect(normalizeAssetRelPath('assets/../evil.png')).toBeNull()
    expect(normalizeAssetRelPath('docs/x.png')).toBeNull()
    expect(normalizeAssetRelPath('assets/..')).toBeNull()
    expect(normalizeAssetRelPath('assets/.')).toBeNull()
  })

  it('allows nested dirs under assets/', () => {
    expect(normalizeAssetRelPath('assets/sub/x.png')).toBe('assets/sub/x.png')
    expect(normalizeAssetRelPath('./assets/a/b/c.webp')).toBe('assets/a/b/c.webp')
  })

  it('allows filenames containing .. as a substring (not a path component)', () => {
    expect(normalizeAssetRelPath('assets/foo..bar.png')).toBe('assets/foo..bar.png')
    expect(normalizeAssetRelPath('assets/ast_x_notes..v2.png')).toBe(
      'assets/ast_x_notes..v2.png',
    )
  })
})

describe('resolveAssetDataUrl', () => {
  it('caches data URLs per space+path', async () => {
    const read = vi
      .fn()
      .mockResolvedValue({ mime: 'image/png', base64: 'abc' })
    const a = await resolveAssetDataUrl('spc_1', 'assets/x.png', { read })
    const b = await resolveAssetDataUrl('spc_1', 'assets/x.png', { read })
    expect(a?.dataUrl).toBe('data:image/png;base64,abc')
    expect(b?.dataUrl).toBe(a?.dataUrl)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('returns null on read failure', async () => {
    const read = vi.fn().mockRejectedValue(new Error('too large'))
    expect(await resolveAssetDataUrl('spc_1', 'assets/x.png', { read })).toBeNull()
  })
})

describe('asset helpers', () => {
  it('builds image vs link markdown', () => {
    expect(assetMarkdown('assets/a.png', 'photo.png', 'image/png')).toBe(
      '![photo](assets/a.png)',
    )
    expect(assetMarkdown('assets/a.pdf', 'doc.pdf', 'application/pdf')).toBe(
      '[doc.pdf](assets/a.pdf)',
    )
  })

  it('inline size and mime allowlist', () => {
    expect(isInlineSizeOk(KNOWLEDGE_ASSET_INLINE_MAX_BYTES)).toBe(true)
    expect(isInlineSizeOk(KNOWLEDGE_ASSET_INLINE_MAX_BYTES + 1)).toBe(false)
    expect(isAllowedAssetMime('image/png')).toBe(true)
    expect(isAllowedAssetMime('image/svg+xml')).toBe(false)
    expect(mimeFromFileName('x.JPEG')).toBe('image/jpeg')
  })
})
