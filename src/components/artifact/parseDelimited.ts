/**
 * Minimal CSV / TSV parser for file preview tables.
 * Supports quoted fields, escaped quotes (""), and \r\n / \n line endings.
 * Not a full RFC 4180 suite — good enough for workspace previews.
 */

export type Delimiter = ',' | '\t'

export function delimiterForPath(path: string): Delimiter {
  const lower = path.toLowerCase()
  if (lower.endsWith('.tsv') || lower.endsWith('.tab')) return '\t'
  return ','
}

/**
 * Parse delimited text into rows of string cells.
 * Trailing empty line is dropped. Empty input → [].
 */
export function parseDelimited(text: string, delimiter: Delimiter = ','): string[][] {
  if (!text) return []
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let i = 0
  let inQuotes = false

  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    rows.push(row)
    row = []
  }

  while (i < text.length) {
    const ch = text[i]!

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }

    if (ch === delimiter) {
      pushField()
      i += 1
      continue
    }

    if (ch === '\n') {
      pushField()
      pushRow()
      i += 1
      continue
    }

    if (ch === '\r') {
      pushField()
      pushRow()
      i += 1
      if (text[i] === '\n') i += 1
      continue
    }

    field += ch
    i += 1
  }

  // Last field / row (no trailing newline).
  if (field.length > 0 || row.length > 0 || inQuotes) {
    pushField()
    pushRow()
  }

  // Strip a single trailing empty row produced by a final newline ("a,b\n").
  if (rows.length > 0) {
    const last = rows[rows.length - 1]!
    if (last.length === 1 && last[0] === '') rows.pop()
  }

  return rows
}

/** Cap rows shown in the preview table (header counts as a row). */
export const CSV_PREVIEW_MAX_ROWS = 200
