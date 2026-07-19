import { describe, expect, it } from 'vitest'
import { buildDocHtmlDocument, markdownToSimpleHtml } from './htmlExport'

describe('markdownToSimpleHtml', () => {
  it('converts headings and paragraphs', () => {
    const html = markdownToSimpleHtml('# Title\n\nHello **world**')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>world</strong>')
  })

  it('escapes HTML in text', () => {
    expect(markdownToSimpleHtml('a <b> c')).toContain('&lt;b&gt;')
  })
})

describe('buildDocHtmlDocument', () => {
  it('wraps body in full HTML shell', () => {
    const doc = buildDocHtmlDocument({
      title: 'T',
      rawMd: '---\nstatus: draft\n---\n\n# Hi\n',
      spaceName: 'S',
    })
    expect(doc).toContain('<!DOCTYPE html>')
    expect(doc).toContain('<h1>Hi</h1>')
    expect(doc).not.toContain('status: draft')
  })
})
