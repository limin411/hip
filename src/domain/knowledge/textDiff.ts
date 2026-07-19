/**
 * Line-based unified diff for knowledge version history (no external dep).
 */

export type DiffLine = {
  type: 'same' | 'add' | 'del'
  text: string
  oldNo: number | null
  newNo: number | null
}

/** Cap to keep UI responsive on large docs. */
export const DIFF_LINE_CAP = 4000

/**
 * Myers-lite: LCS-based line diff. O(n*m) — cap inputs first.
 */
export function diffLines(oldText: string, newText: string, cap = DIFF_LINE_CAP): DiffLine[] {
  let a = oldText.replace(/\r\n/g, '\n').split('\n')
  let b = newText.replace(/\r\n/g, '\n').split('\n')
  let truncated = false
  if (a.length > cap) {
    a = a.slice(0, cap)
    truncated = true
  }
  if (b.length > cap) {
    b = b.slice(0, cap)
    truncated = true
  }

  const n = a.length
  const m = b.length
  // dp[i][j] = LCS length of a[i:] b[j:] — use rolling for memory? keep simple 2d for cap 4k
  // 4000^2 = 16M ints — too big. Use patience-like simple walk instead.

  // Simple O(n+m) with hash map of equal runs (not perfect but fine for notes):
  // Use classic LCS with band if small, else greedy.
  if (n * m > 1_500_000) {
    return greedyDiff(a, b, truncated)
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  let oldNo = 1
  let newNo = 1
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i]!, oldNo: oldNo++, newNo: newNo++ })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i]!, oldNo: oldNo++, newNo: null })
      i++
    } else {
      out.push({ type: 'add', text: b[j]!, oldNo: null, newNo: newNo++ })
      j++
    }
  }
  while (i < n) {
    out.push({ type: 'del', text: a[i]!, oldNo: oldNo++, newNo: null })
    i++
  }
  while (j < m) {
    out.push({ type: 'add', text: b[j]!, oldNo: null, newNo: newNo++ })
    j++
  }
  if (truncated) {
    out.push({
      type: 'same',
      text: '… (diff truncated for size)',
      oldNo: null,
      newNo: null,
    })
  }
  return out
}

function greedyDiff(a: string[], b: string[], truncated: boolean): DiffLine[] {
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  let oldNo = 1
  let newNo = 1
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ type: 'same', text: a[i]!, oldNo: oldNo++, newNo: newNo++ })
      i++
      j++
    } else if (j < b.length && (i >= a.length || !a.slice(i).includes(b[j]!))) {
      out.push({ type: 'add', text: b[j]!, oldNo: null, newNo: newNo++ })
      j++
    } else if (i < a.length) {
      out.push({ type: 'del', text: a[i]!, oldNo: oldNo++, newNo: null })
      i++
    } else {
      break
    }
  }
  if (truncated) {
    out.push({
      type: 'same',
      text: '… (diff truncated for size)',
      oldNo: null,
      newNo: null,
    })
  }
  return out
}
