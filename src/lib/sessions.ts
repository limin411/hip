// 仅依赖 title/preview 两个展示字段，对 MockSession / SessionVM 通用
export function filterSessions<T extends { title: string; preview: string }>(sessions: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return sessions
  return sessions.filter((s) => s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q))
}
