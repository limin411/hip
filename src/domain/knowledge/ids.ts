import { nanoid } from 'nanoid'

/** Shared with Rust: full prefix regex for knowledge entity ids. */
export const KNOWLEDGE_ID_RE = /^(spc|nod|doc)_[A-Za-z0-9_-]{6,64}$/

export function isKnowledgeId(id: string): boolean {
  return KNOWLEDGE_ID_RE.test(id)
}

export function newSpaceId(): string {
  return `spc_${nanoid(12)}`
}

export function newFolderId(): string {
  return `nod_${nanoid(12)}`
}

export function newDocId(): string {
  return `doc_${nanoid(12)}`
}
