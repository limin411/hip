import { describe, it, expect } from 'vitest'
import { previewKind } from './previewKind'

describe('previewKind', () => {
  it('detects markdown', () => expect(previewKind('/a/README.md', 'text/markdown')).toBe('markdown'))
  it('detects html', () => expect(previewKind('/a/index.html', 'text/html')).toBe('html'))
  it('detects image by mime', () => expect(previewKind('/a/logo.png', 'image/png')).toBe('image'))
  it('detects image by ext', () => expect(previewKind('/a/pic.svg', 'image/svg+xml')).toBe('image'))
  it('falls back to text for code', () => expect(previewKind('/a/main.ts', 'text/plain')).toBe('text'))
  it('returns none for unknown extension-less binary', () => expect(previewKind('/a/blob')).toBe('none'))
})
