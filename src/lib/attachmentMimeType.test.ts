import { describe, it, expect } from 'vitest'
import { getAttachmentMimeType } from './attachmentMimeType'

describe('getAttachmentMimeType', () => {
  it('returns image/png for png', () => {
    expect(getAttachmentMimeType('photo.png')).toBe('image/png')
  })
  it('returns application/pdf for pdf', () => {
    expect(getAttachmentMimeType('doc.pdf')).toBe('application/pdf')
  })
  it('returns text/plain for txt', () => {
    expect(getAttachmentMimeType('notes.txt')).toBe('text/plain')
  })
  it('falls back to octet-stream', () => {
    expect(getAttachmentMimeType('unknown.unknown')).toBe('application/octet-stream')
  })
})
