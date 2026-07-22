import { describe, it, expect } from 'vitest'
import { isFeAllowedAttachment, isMultimodalAttachmentMime } from './attachmentAllowlist'
import { getAttachmentMimeType } from './attachmentMimeType'

describe('isFeAllowedAttachment', () => {
  it('allows text extensions even when mime is language-specific', () => {
    expect(isFeAllowedAttachment('a.ts', getAttachmentMimeType('a.ts'))).toBe(true)
    expect(isFeAllowedAttachment('a.tsx', getAttachmentMimeType('a.tsx'))).toBe(true)
    expect(isFeAllowedAttachment('a.py', getAttachmentMimeType('a.py'))).toBe(true)
    expect(isFeAllowedAttachment('a.md', 'text/markdown')).toBe(true)
  })

  it('allows image and pdf', () => {
    expect(isFeAllowedAttachment('x.png', 'image/png')).toBe(true)
    expect(isFeAllowedAttachment('x.pdf', 'application/pdf')).toBe(true)
  })

  it('rejects unknown / binary types', () => {
    expect(isFeAllowedAttachment('Makefile', getAttachmentMimeType('Makefile'))).toBe(false)
    expect(isFeAllowedAttachment('a.exe', getAttachmentMimeType('a.exe'))).toBe(false)
    expect(isFeAllowedAttachment('a.bin', 'application/octet-stream')).toBe(false)
  })
})

describe('isMultimodalAttachmentMime', () => {
  it('classifies image/pdf/video', () => {
    expect(isMultimodalAttachmentMime('image/png')).toBe(true)
    expect(isMultimodalAttachmentMime('application/pdf')).toBe(true)
    expect(isMultimodalAttachmentMime('video/mp4')).toBe(true)
    expect(isMultimodalAttachmentMime('text/plain')).toBe(false)
    expect(isMultimodalAttachmentMime('text/typescript')).toBe(false)
  })
})
