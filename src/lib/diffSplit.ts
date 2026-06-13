import type { DiffLine } from '@hip/protocol'

export interface SplitRow { left: DiffLine | null; right: DiffLine | null }

/** 把统一 diff 行序列转成左右两栏:ctx 两侧镜像;del-run/add-run 逐行对齐,空缺补 null。 */
export function buildSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (l.type === 'ctx') { rows.push({ left: l, right: l }); i++; continue }
    if (l.type === 'del') {
      let j = i; while (j < lines.length && lines[j].type === 'del') j++
      let k = j; while (k < lines.length && lines[k].type === 'add') k++
      const dels = lines.slice(i, j), adds = lines.slice(j, k)
      for (let x = 0; x < Math.max(dels.length, adds.length); x++) rows.push({ left: dels[x] ?? null, right: adds[x] ?? null })
      i = k; continue
    }
    let k = i; while (k < lines.length && lines[k].type === 'add') k++
    for (let x = i; x < k; x++) rows.push({ left: null, right: lines[x] })
    i = k
  }
  return rows
}
