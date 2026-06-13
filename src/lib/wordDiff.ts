import type { DiffLine } from '@hip/protocol'

export interface WordDiffSpan { text: string; changed: boolean }
export interface WordDiffPair { del: WordDiffSpan[]; add: WordDiffSpan[] }

/** 公共前缀 + 公共后缀,中段标为 changed。O(n),适合单行配对高亮。 */
export function wordDiff(a: string, b: string): WordDiffPair {
  const max = Math.min(a.length, b.length)
  let p = 0
  while (p < max && a[p] === b[p]) p++
  let s = 0
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  const span = (pre: string, mid: string, suf: string): WordDiffSpan[] => {
    const out: WordDiffSpan[] = []
    if (pre) out.push({ text: pre, changed: false })
    if (mid) out.push({ text: mid, changed: true })
    if (suf) out.push({ text: suf, changed: false })
    return out.length ? out : [{ text: '', changed: false }]
  }
  return {
    del: span(a.slice(0, p), a.slice(p, a.length - s), a.slice(a.length - s)),
    add: span(b.slice(0, p), b.slice(p, b.length - s), b.slice(b.length - s)),
  }
}

/** 对一个 hunk 的 lines:把等长的 del-run→add-run 逐行配对算 word diff。
 *  返回与 lines 等长的数组,配对行为 span[],其余为 null。 */
export function computeHunkWordDiffs(lines: DiffLine[]): (WordDiffSpan[] | null)[] {
  const out: (WordDiffSpan[] | null)[] = lines.map(() => null)
  let i = 0
  while (i < lines.length) {
    if (lines[i].type === 'del') {
      let j = i; while (j < lines.length && lines[j].type === 'del') j++
      let k = j; while (k < lines.length && lines[k].type === 'add') k++
      const dels = j - i, adds = k - j
      if (dels > 0 && dels === adds) {
        for (let n = 0; n < dels; n++) {
          const wd = wordDiff(lines[i + n].content, lines[j + n].content)
          out[i + n] = wd.del
          out[j + n] = wd.add
        }
      }
      i = k
    } else i++
  }
  return out
}
