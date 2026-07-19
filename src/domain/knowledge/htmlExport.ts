/**
 * Offline HTML export for a knowledge document (wiki links → plain text titles).
 */

import { parseFrontmatter } from './frontmatter'
import { extractWikiLinks, splitWikiTitleFragment } from './wikiLink'
import { extractEmbedLinks } from './linkExtract'

/** Escape for HTML text/attr. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Very small MD→HTML for export: headings, paragraphs, lists, code, bold/italic,
 * links, images (relative assets paths preserved), wiki → bold titles.
 * Not a full CommonMark engine — good enough for offline share + print-to-PDF.
 */
export function markdownToSimpleHtml(md: string): string {
  let body = md.replace(/\r\n/g, '\n')

  // Strip embeds to a note
  for (const h of extractEmbedLinks(body).reverse()) {
    body =
      body.slice(0, h.start) +
      `\u0000EMB${escapeHtml(h.title)}\u0000` +
      body.slice(h.end)
  }
  // Wiki → placeholders
  for (const h of extractWikiLinks(body).reverse()) {
    if (h.start > 0 && body[h.start - 1] === '!') continue
    const { docTitle, fragment } = splitWikiTitleFragment(h.title)
    const label =
      h.display ?? ((fragment ? `${docTitle}#${fragment}` : docTitle) || h.title)
    body =
      body.slice(0, h.start) + `\u0000WIK${escapeHtml(label)}\u0000` + body.slice(h.end)
  }

  // Fenced code (capture before escape)
  const codeBlocks: string[] = []
  body = body.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    const l = lang ? ` class="language-${escapeHtml(lang)}"` : ''
    const html = `<pre><code${l}>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`
    codeBlocks.push(html)
    return `\u0000COD${codeBlocks.length - 1}\u0000`
  })

  // Images / links before global escape of leftovers
  body = body.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, src: string) => {
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`
  })
  body = body.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, href: string) => {
    return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`
  })

  // Headings
  body = body.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes: string, title: string) => {
    const n = hashes.length
    return `<h${n}>${escapeHtml(title.trim())}</h${n}>`
  })

  body = body.replace(/^---$/gm, '<hr />')

  // Escape plain text; protect only placeholders + tags we just injected (img/a/h*/hr).
  body = body
    .split(
      /(\u0000(?:EMB|WIK|COD)[^\u0000]*\u0000|<\/?(?:img|a|h[1-6]|hr)(?:\s[^>]*)?\/?>)/gi,
    )
    .map((part) => {
      if (!part) return ''
      if (part.startsWith('\u0000') || part.startsWith('<')) return part
      return escapeHtml(part)
    })
    .join('')

  // Restore placeholders
  body = body.replace(/\u0000EMB([^\u0000]*)\u0000/g, (_m, t: string) => {
    return `<p><em>[embed: ${t}]</em></p>`
  })
  body = body.replace(/\u0000WIK([^\u0000]*)\u0000/g, (_m, t: string) => {
    return `<strong class="wiki">${t}</strong>`
  })
  body = body.replace(/\u0000COD(\d+)\u0000/g, (_m, i: string) => {
    return codeBlocks[Number(i)] ?? ''
  })

  // Bold / italic / code (on already-escaped text — safe)
  body = body.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  body = body.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  body = body.replace(/`([^`]+)`/g, '<code>$1</code>')

  const chunks = body.split(/\n{2,}/)
  const out = chunks.map((chunk) => {
    const t = chunk.trim()
    if (!t) return ''
    if (/^<(h[1-6]|pre|hr|p|ul|ol|blockquote|img|aside|strong|em)/i.test(t)) return t
    if (/^[-*]\s/m.test(t) || /^\d+\.\s/m.test(t)) {
      const items = t.split('\n').filter(Boolean)
      const isOl = /^\d+\./.test(items[0] ?? '')
      const tag = isOl ? 'ol' : 'ul'
      const lis = items
        .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, ''))
        .map((line) => `<li>${line}</li>`)
        .join('')
      return `<${tag}>${lis}</${tag}>`
    }
    return `<p>${t.replace(/\n/g, '<br />')}</p>`
  })

  return out.filter(Boolean).join('\n')
}

export function buildDocHtmlDocument(opts: {
  title: string
  rawMd: string
  spaceName?: string
}): string {
  const { bodyWithoutFm } = parseFrontmatter(opts.rawMd)
  const htmlBody = markdownToSimpleHtml(bodyWithoutFm)
  const title = escapeHtml(opts.title)
  const space = opts.spaceName ? escapeHtml(opts.spaceName) : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.55; max-width: 44rem; margin: 2rem auto; padding: 0 1.25rem; color: #111; }
  @media (prefers-color-scheme: dark) { body { color: #e8e8e8; background: #121212; } }
  h1,h2,h3,h4 { line-height: 1.25; }
  pre { overflow-x: auto; padding: 0.75rem; border-radius: 6px; background: #f4f4f5; }
  @media (prefers-color-scheme: dark) { pre { background: #1e1e1e; } }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 0.35rem 0.5rem; }
  .meta { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .wiki { font-weight: 600; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 1.5rem 0; }
</style>
</head>
<body>
<header class="meta">${space ? `${space} · ` : ''}${title}</header>
<article>
${htmlBody}
</article>
</body>
</html>
`
}
