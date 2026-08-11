export type KnowledgeNodeKind = 'folder' | 'doc' | 'table' | 'board'

export interface KnowledgeSpace {
  id: string
  name: string
  icon?: string
  createdAt: number
  updatedAt: number
}

export interface KnowledgeIndex {
  version: 1
  spaces: KnowledgeSpace[]
}

export interface KnowledgeNode {
  id: string
  parentId: string | null
  kind: KnowledgeNodeKind
  title: string
  order: number
  createdAt: number
  updatedAt: number
}

export interface KnowledgeTreeFile {
  version: 1
  nodes: KnowledgeNode[]
}

export interface KnowledgeRecentItem {
  spaceId: string
  /** Leaf id: `doc_*`, `tbl_*` or legacy `brd_*` (field name kept for localStorage compat). */
  docId: string
  title: string
  spaceName: string
  at: number
}

/** Space-level document template (`templates/tpl_*.md` + `templates.json`). */
export interface KnowledgeTemplate {
  id: string
  name: string
  body: string
  createdAt: number
  updatedAt: number
}

export type KnowledgeVersionKind = 'daily' | 'manual'

export interface KnowledgeVersionEntry {
  /** File stem / id (filesystem-safe ISO timestamp). */
  id: string
  file: string
  createdAt: number
  kind: KnowledgeVersionKind | string
  dayKey?: string
  byteLength: number
}
