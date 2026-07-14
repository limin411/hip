export type KnowledgeNodeKind = 'folder' | 'doc'

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
  docId: string
  title: string
  spaceName: string
  at: number
}

export type KnowledgeVersionKind = 'daily' | 'manual'

export interface KnowledgeVersionEntry {
  id: string
  file: string
  createdAt: number
  kind: KnowledgeVersionKind | string
  dayKey?: string
  byteLength: number
}
