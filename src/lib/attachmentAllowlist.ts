/**
 * FE parity with packages/sidecar/src/session/attachments.ts isAllowedAttachment.
 * Used at @-select time so chips are not created for types that fail at send.
 */

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
  '.xml',
  '.toml',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.html',
  '.css',
  '.scss',
  '.sql',
  '.sh',
  '.ps1',
])

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'application/json',
  'text/yaml',
  'text/csv',
  'application/xml',
  'text/xml',
  'text/toml',
  'text/javascript',
  'text/typescript',
  'text/html',
  'text/css',
])

function extname(name: string): string {
  const i = name.lastIndexOf('.')
  if (i <= 0) return ''
  return name.slice(i).toLowerCase()
}

/** Whether sidecar would accept this as an attachment (image/PDF/text allowlist). */
export function isFeAllowedAttachment(name: string, mimeType: string): boolean {
  if (mimeType.startsWith('image/')) return true
  if (mimeType === 'application/pdf') return true
  if (TEXT_MIME_TYPES.has(mimeType)) return true
  return TEXT_EXTENSIONS.has(extname(name))
}

/** Multimodal attachments that FE wipe / paperclip gate on unsupported models. */
export function isMultimodalAttachmentMime(mimeType: string): boolean {
  return (
    mimeType.startsWith('image/') ||
    mimeType === 'application/pdf' ||
    mimeType.startsWith('video/')
  )
}
