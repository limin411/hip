import { describe, it, expect } from 'vitest'
import { previewKind } from './previewKind'

describe('previewKind', () => {
  it('detects markdown', () => expect(previewKind('/a/README.md', 'text/markdown')).toBe('markdown'))
  it('detects mdx as markdown by ext', () => expect(previewKind('/a/page.mdx')).toBe('markdown'))
  it('detects html', () => expect(previewKind('/a/index.html', 'text/html')).toBe('html'))
  it('detects xhtml as html by ext', () => expect(previewKind('/a/page.xhtml')).toBe('html'))
  it('detects image by mime', () => expect(previewKind('/a/logo.png', 'image/png')).toBe('image'))
  it('detects image by ext', () => expect(previewKind('/a/pic.svg', 'image/svg+xml')).toBe('image'))
  it('detects pdf by ext', () => expect(previewKind('/a/report.pdf', 'application/pdf')).toBe('pdf'))
  it('detects svg as image by ext (no mime)', () => expect(previewKind('/a/icon.svg')).toBe('image'))

  it('detects json by ext and mime', () => {
    expect(previewKind('/a/package.json')).toBe('json')
    expect(previewKind('/a/x.jsonc')).toBe('json')
    expect(previewKind('/a/data', 'application/json')).toBe('json')
  })

  it('detects csv/tsv by ext', () => {
    expect(previewKind('/a/data.csv')).toBe('csv')
    expect(previewKind('/a/data.tsv')).toBe('csv')
  })

  it('detects highlightable code', () => {
    expect(previewKind('/a/main.ts', 'text/plain')).toBe('code')
    expect(previewKind('/a/App.vue')).toBe('text') // no shiki grammar → plain text
    expect(previewKind('/a/Main.kt')).toBe('code')
    expect(previewKind('/a/lib.rs')).toBe('code')
  })

  it('falls back to text for unknown extensions', () => {
    expect(previewKind('/a/notes.unknown')).toBe('text')
  })

  it('returns none for unknown extension-less binary', () => {
    expect(previewKind('/a/blob')).toBe('none')
  })
})
