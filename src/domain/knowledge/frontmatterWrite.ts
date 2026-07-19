/**
 * Serialize KnowledgeDocMeta back to YAML frontmatter + body.
 */

import type { KnowledgeDocMeta } from './frontmatter'
import { parseFrontmatter } from './frontmatter'

function quoteIfNeeded(s: string): string {
  if (/[:#{}[\],&*?|>!%@`]/.test(s) || s.includes("'") || s.includes('"') || /\s/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return s
}

function writeList(key: string, items: string[]): string[] {
  if (items.length === 0) return []
  if (items.length <= 4 && items.every((i) => i.length < 40)) {
    return [`${key}: [${items.map(quoteIfNeeded).join(', ')}]`]
  }
  return [`${key}:`, ...items.map((i) => `  - ${quoteIfNeeded(i)}`)]
}

/** Build `---\n…\n---` fence from meta. Empty when no properties set. */
export function formatFrontmatterFence(meta: KnowledgeDocMeta): string {
  const lines: string[] = []
  if (meta.tags.length) lines.push(...writeList('tags', meta.tags))
  if (meta.status) lines.push(`status: ${quoteIfNeeded(meta.status)}`)
  if (meta.aliases.length) lines.push(...writeList('aliases', meta.aliases))
  if (meta.date) lines.push(`date: ${quoteIfNeeded(meta.date)}`)
  if (meta.priority) lines.push(`priority: ${quoteIfNeeded(meta.priority)}`)

  const propKeys = Object.keys(meta.props).sort()
  for (const k of propKeys) {
    const v = meta.props[k]
    if (v === undefined || v === null) continue
    if (typeof v === 'boolean') {
      lines.push(`${k}: ${v ? 'true' : 'false'}`)
    } else if (typeof v === 'number') {
      lines.push(`${k}: ${v}`)
    } else if (Array.isArray(v)) {
      lines.push(...writeList(k, v.map(String)))
    } else if (String(v).length) {
      lines.push(`${k}: ${quoteIfNeeded(String(v))}`)
    }
  }

  if (lines.length === 0) return ''
  return `---\n${lines.join('\n')}\n---`
}

/**
 * Replace or strip frontmatter on a full document, keeping body text.
 */
export function applyMetaToDocument(raw: string, meta: KnowledgeDocMeta): string {
  const { bodyWithoutFm } = parseFrontmatter(raw)
  const fence = formatFrontmatterFence(meta)
  if (!fence) {
    // Drop FM if meta empty
    return bodyWithoutFm.replace(/^\n/, '')
  }
  const body = bodyWithoutFm.startsWith('\n')
    ? bodyWithoutFm
    : bodyWithoutFm.length
      ? `\n${bodyWithoutFm}`
      : '\n'
  // Prefer single blank line after fence
  const bodyNorm = body.startsWith('\n') ? body : `\n${body}`
  return `${fence}${bodyNorm.startsWith('\n\n') ? bodyNorm.slice(1) : bodyNorm}`
}
