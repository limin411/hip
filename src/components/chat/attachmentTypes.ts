export type LocalAttachment = {
  id: string
  name: string
  mimeType: string
  path: string
  /** paperclip default when omitted for back-compat; FE-only (not on wire). */
  source?: 'paperclip' | 'at-mention'
}
