// packages/sidecar/src/session/skills/frontmatter.ts
import { parse as parseYaml } from 'yaml'

/** Parsed frontmatter: unknown-typed values keyed by their YAML field name. */
export interface Frontmatter {
  data: Record<string, unknown>
  body: string
}

/**
 * Full-YAML frontmatter parser using the `yaml` library.
 *
 * Extracts the leading `---`-fenced YAML block and parses it with yaml.parse(),
 * supporting scalars, booleans, numbers, arrays, nested objects, and multi-line strings.
 *
 * No frontmatter (or a missing closing fence, or an opening fence not on line 1)
 * → `{ data: {}, body: src }`. Invalid YAML in the block → graceful fallback to
 * `{ data: {}, body: src }` (never throws).
 */
export function parseFrontmatter(src: string): Frontmatter {
  const normalized = src.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0] !== '---') return { data: {}, body: src }

  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { end = i; break }
  }
  if (end === -1) return { data: {}, body: src }

  const yamlBlock = lines.slice(1, end).join('\n')

  let data: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(yamlBlock)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>
    }
  } catch {
    // Invalid YAML — graceful degrade to empty data
  }

  const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '')
  return { data, body }
}
