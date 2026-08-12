/**
 * ui-enhancement-bui (S2 / P0-1)：流式文本词块切分。
 *
 * 把一段正文切成「浮现块」——拉丁按空白 token 累积 ≈3 词一块；
 * CJK 无空白 run 按 6 字切片；混合 run 兜底按长度。纯函数，无 DOM 依赖。
 *
 * 约定：chunks 拼接恒等于原文（不丢字符、不插空格），React 按索引 key
 * 复用旧 span，append-only 增长下只有新增块会触发浮现动画。
 */
const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/u
/** 拉丁块目标词数 */
const LATIN_WORDS = 3
/** CJK 块目标字数 */
const CJK_CHARS = 6

export function chunkStreamText(text: string): string[] {
  if (!text) return []
  const chunks: string[] = []
  let acc = ''

  const flush = () => {
    if (acc) {
      chunks.push(acc)
      acc = ''
    }
  }

  const tokenRe = /\S+\s*/g
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(text))) {
    const tok = m[0]
    const hasCjk = CJK_RE.test(tok)
    if (hasCjk && !/\s/.test(tok)) {
      // 无空白 CJK run（含混合尾巴）：按字数切片
      flush()
      for (let i = 0; i < tok.length; i += CJK_CHARS) {
        chunks.push(tok.slice(i, i + CJK_CHARS))
      }
    } else {
      acc += tok
      const words = acc.split(/\s+/).filter(Boolean).length
      if (words >= LATIN_WORDS && acc.length >= 6) flush()
    }
  }
  flush()
  return chunks
}
