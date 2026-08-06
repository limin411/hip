/**
 * Soft-equality helper for Source↔Live *comparison* only (not a disk save filter).
 *
 * Live (`getMarkdown`) is a canonicalizing writer — list markers, table seps, and
 * autolink form may rewrite. Use this for tests / comparison UX, never silently
 * rewrite saves unless product asks.
 *
 * Contract normalize from knowledge-phase-0-1-implementation + PR-09a spike:
 * - ensure single trailing `\n` (empty doc stays `''`)
 * - list marker unify to `- `
 * - task markers `- [ ]` / `- [x]` lowercase x
 * - collapse blank lines between consecutive list items of the same kind
 * - normalize GFM table separator cells to `---`
 * - unwrap autolink angle brackets `<https://…>` → `https://…`
 * - trailing spaces per line: leave on (do not strip)
 */
export function normalizeMd(s: string): string {
  let out = s.replace(/\r\n/g, '\n')
  // unify unordered list markers (* / +) → -
  out = out.replace(/^(\s*)[*+](\s+(?:\[[ xX]\]\s+)?)/gm, '$1-$2')
  // task checkbox letter → lowercase x
  out = out.replace(/^(\s*-\s+\[)X(\]\s+)/gm, '$1x$2')
  // Live/MD writers may insert blank lines between sibling items of the *same*
  // list kind (ul↔ul or ol↔ol). Keep blank lines that separate different list blocks.
  out = out.replace(/(^|\n)([ \t]*[-*][^\n]*)\n\n(?=[ \t]*[-*])/g, '$1$2\n')
  out = out.replace(/(^|\n)([ \t]*\d+\.[^\n]*)\n\n(?=[ \t]*\d+\.)/g, '$1$2\n')
  // table separator: | - | --- | :---: | → | --- |
  out = out.replace(/^\|([^\n]+)\|$/gm, (line) => {
    if (!/^\|(\s*:?-{1,}:?\s*\|)+$/.test(line)) return line
    return (
      '|' +
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => {
          const t = cell.trim()
          if (/^:?-{1,}:?$/.test(t)) {
            if (t.startsWith(':') && t.endsWith(':')) return ' :---: '
            if (t.startsWith(':')) return ' :--- '
            if (t.endsWith(':')) return ' ---: '
            return ' --- '
          }
          return cell
        })
        .join('|') +
      '|'
    )
  })
  // autolink form
  out = out.replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
  // single trailing newline; empty stays empty
  if (out.trim() === '') return ''
  out = out.replace(/\n*$/, '\n')
  return out
}
