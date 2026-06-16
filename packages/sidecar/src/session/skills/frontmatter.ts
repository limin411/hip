// packages/sidecar/src/session/skills/frontmatter.ts

/** Parsed frontmatter: scalar string values keyed by their YAML field name. */
export interface Frontmatter {
  data: Record<string, string>
  body: string
}

/** Strip one matching pair of surrounding single or double quotes from a scalar value. */
function unquote(raw: string): string {
  const v = raw.trim()
  if (v.length >= 2) {
    const first = v[0]
    const last = v[v.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return v.slice(1, -1)
    }
  }
  return v
}

/**
 * Minimal, dependency-free YAML-frontmatter splitter for SKILL.md.
 * Only flat `key: value` scalar lines are parsed (enough for `name`/`description`);
 * non-scalar/nested YAML is ignored. No frontmatter (or a missing closing fence,
 * or an opening fence not on line 1) → empty data and the whole input as body.
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

  const data: Record<string, string> = {}
  for (let i = 1; i < end; i++) {
    const line = lines[i]
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    if (!key) continue
    data[key] = unquote(line.slice(colon + 1))
  }

  const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '')
  return { data, body }
}
