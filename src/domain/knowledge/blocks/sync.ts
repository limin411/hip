/**
 * 同步块（V2-E1）：嵌入其他文档某块的只读镜像。
 *
 * - 磁盘格式（可读、可手工编辑、破损容错）：
 *   `<!-- hip-sync:<nodeId>#<anchor> -->`（anchor = 标题文本/块文本，跨重载稳定）
 * - Live：`sync` 块（content: 'none'），props 存 nodeId/title/anchor；
 *   渲染时读取源文档并定位锚点块，展示只读镜像。
 * - 解除同步 = 变为普通引用链接 `[[title#anchor]]`（内容不再跟随）。
 * - 自引用（嵌入自身）被拒绝。
 */
export const SYNC_GUARD_PROBE = /<!--\s*hip-sync:([A-Za-z0-9_-]+)#([^>]+?)\s*-->/i

/** Extract a well-formed sync guard; null when malformed. */
export function extractSyncGuard(md: string): {
  nodeId: string
  anchor: string
} | null {
  const m = SYNC_GUARD_PROBE.exec(md)
  if (!m) return null
  const nodeId = m[1]!.trim()
  const anchor = m[2]!.trim()
  if (!nodeId || !anchor) return null
  return { nodeId, anchor }
}

/** Serialize a sync block into the guard form. */
export function joinSyncGuard(nodeId: string, anchor: string): string {
  return `<!-- hip-sync:${nodeId}#${anchor.replace(/-->/g, '')} -->`
}

/** 在源文档 md 中按锚点定位块：标题（# 开头）→ 文本包含 → null。 */
export function extractAnchorBlock(
  body: string,
  anchor: string,
): { md: string; text: string } | null {
  const q = anchor.trim()
  if (!q || !body) return null
  const lines = body.split('\n')
  const norm = q.toLowerCase()
  // 1) 标题精确匹配（去 # 前缀）
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    const heading = l.replace(/^#{1,6}\s*/, '')
    if (/^#{1,6}\s+/.test(l) && heading.trim().toLowerCase() === norm) {
      return { md: l, text: heading.trim() }
    }
  }
  // 2) 文本包含匹配（首个非空行）
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (!l.trim()) continue
    if (l.toLowerCase().includes(norm)) {
      return { md: l, text: l.replace(/^[#>\-\s]+/, '').trim() }
    }
  }
  return null
}
