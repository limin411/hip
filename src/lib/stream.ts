// 把文本切成用于「逐字流式」的小块（按字符，保留空白）
export function tokenize(text: string, chunkSize = 2): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize))
  }
  return chunks
}
