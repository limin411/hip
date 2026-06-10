import type { DiffFile, DiffLine } from '@hip/protocol'

export const MAX_DIFF_LINES_PER_FILE = 2000

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Parse `git diff` unified output into per-file DiffFiles. Paths come out exactly as git
 * prints them (repo-root-relative); the caller converts to cwd-relative. Line counts
 * (`additions`/`deletions`) are pre-truncation; `lines` is capped at MAX_DIFF_LINES_PER_FILE.
 */
const GIT_HEADER_RE = /^a\/.+ b\/(.+)$/

export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  for (const chunk of text.split(/^diff --git /m).slice(1)) {
    const rawLines = chunk.split('\n')
    // Extract fallback path from `a/<path> b/<path>` header (first line of chunk).
    const headerMatch = GIT_HEADER_RE.exec(rawLines[0] ?? '')
    let filePath = ''
    let binary = false
    let inHunk = false
    let oldNo = 0
    let newNo = 0
    let additions = 0
    let deletions = 0
    let truncated = false
    const out: DiffLine[] = []
    for (const line of rawLines) {
      if (!inHunk) {
        // Header zone. `---` precedes `+++`; the b/ side wins unless it's /dev/null (deletion).
        if (line.startsWith('--- ')) {
          const p = line.slice(4).trim()
          if (!filePath && p !== '/dev/null') filePath = p.replace(/^a\//, '')
          continue
        }
        if (line.startsWith('+++ ')) {
          const p = line.slice(4).trim()
          if (p !== '/dev/null') filePath = p.replace(/^b\//, '')
          continue
        }
        if (/^Binary files .* differ$/.test(line)) { binary = true; continue }
      }
      const hunk = HUNK_RE.exec(line)
      if (hunk) {
        inHunk = true
        oldNo = parseInt(hunk[1], 10)
        newNo = parseInt(hunk[2], 10)
        continue
      }
      if (!inHunk) continue
      if (line.startsWith('+')) {
        additions++
        if (out.length < MAX_DIFF_LINES_PER_FILE) out.push({ type: 'add', content: line.slice(1), oldNo: null, newNo })
        else truncated = true
        newNo++
      } else if (line.startsWith('-')) {
        deletions++
        if (out.length < MAX_DIFF_LINES_PER_FILE) out.push({ type: 'del', content: line.slice(1), oldNo, newNo: null })
        else truncated = true
        oldNo++
      } else if (line.startsWith(' ')) {
        if (out.length < MAX_DIFF_LINES_PER_FILE) out.push({ type: 'ctx', content: line.slice(1), oldNo, newNo })
        else truncated = true
        oldNo++
        newNo++
      }
      // '\ No newline at end of file' and any other marker lines: skipped.
    }
    // Fall back to b/ path extracted from the `diff --git` header line.
    if (!filePath && headerMatch) filePath = headerMatch[1]
    if (!filePath) continue
    files.push({
      path: filePath,
      additions,
      deletions,
      lines: out,
      ...(truncated ? { truncated: true } : {}),
      ...(binary ? { binary: true } : {}),
    })
  }
  return files
}
