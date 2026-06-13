export type PreviewKind = 'markdown' | 'html' | 'image' | 'pdf' | 'text' | 'none'

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'])

export function previewKind(path: string, mimeType?: string): PreviewKind {
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : ''
  if (mimeType?.startsWith('image/') || IMG_EXT.has(ext)) return 'image'
  if (mimeType === 'application/pdf' || ext === '.pdf') return 'pdf'
  if (mimeType === 'text/markdown' || ext === '.md' || ext === '.markdown') return 'markdown'
  if (mimeType === 'text/html' || ext === '.html' || ext === '.htm') return 'html'
  if (mimeType?.startsWith('text/') || ext) return 'text'
  return 'none'
}
