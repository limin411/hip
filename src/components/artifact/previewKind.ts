import { highlightLangFromPath } from './previewLang'

export type PreviewKind =
  | 'markdown'
  | 'html'
  | 'image'
  | 'pdf'
  | 'json'
  | 'csv'
  | 'code'
  | 'text'
  | 'none'

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'])
const JSON_EXT = new Set(['.json', '.jsonc'])
const CSV_EXT = new Set(['.csv', '.tsv', '.tab'])

function pathExt(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot).toLowerCase()
}

export function previewKind(path: string, mimeType?: string): PreviewKind {
  const ext = pathExt(path)
  if (mimeType?.startsWith('image/') || IMG_EXT.has(ext)) return 'image'
  if (mimeType === 'application/pdf' || ext === '.pdf') return 'pdf'
  if (mimeType === 'text/markdown' || ext === '.md' || ext === '.markdown' || ext === '.mdx') {
    return 'markdown'
  }
  if (mimeType === 'text/html' || ext === '.html' || ext === '.htm' || ext === '.xhtml') {
    return 'html'
  }
  if (
    mimeType === 'application/json' ||
    mimeType === 'text/json' ||
    JSON_EXT.has(ext)
  ) {
    return 'json'
  }
  if (
    mimeType === 'text/csv' ||
    mimeType === 'text/tab-separated-values' ||
    CSV_EXT.has(ext)
  ) {
    return 'csv'
  }
  // Known highlightable source → code (syntax). Else plain text if anything text-like.
  if (highlightLangFromPath(path)) return 'code'
  if (mimeType?.startsWith('text/') || ext) return 'text'
  return 'none'
}
