import { describe, expect, it } from 'vitest'
import {
  isKnowledgeId,
  KNOWLEDGE_ID_RE,
  newBoardId,
  newDocId,
  newFolderId,
  newSpaceId,
  newTableId,
} from './ids'

describe('knowledge ids', () => {
  it('accepts brd_ prefix in KNOWLEDGE_ID_RE', () => {
    expect(KNOWLEDGE_ID_RE.test('brd_xxxxxxxxxxxx')).toBe(true)
    expect(isKnowledgeId('brd_board0001')).toBe(true)
    expect(isKnowledgeId('doc_abc123def456')).toBe(true)
    expect(isKnowledgeId('nod_folder001')).toBe(true)
    expect(isKnowledgeId('spc_xYzAbCdEfGhI')).toBe(true)
    expect(isKnowledgeId('tbl_table00001')).toBe(true)
    // Imported/legacy spaces keep readable ids (may be shorter than 6 chars).
    expect(isKnowledgeId('nod_agent')).toBe(true)
    expect(isKnowledgeId('doc_abc')).toBe(true)
  })

  it('rejects illegal ids', () => {
    expect(isKnowledgeId('')).toBe(false)
    expect(isKnowledgeId('foo_bar')).toBe(false)
    expect(isKnowledgeId('brd_ab')).toBe(false)
    expect(isKnowledgeId('brd_../evil')).toBe(false)
    expect(isKnowledgeId('tbl_ab')).toBe(false)
    expect(isKnowledgeId('tbl_../evil')).toBe(false)
  })

  it('newTableId generates tbl_ prefix with valid id', () => {
    const id = newTableId()
    expect(id.startsWith('tbl_')).toBe(true)
    expect(isKnowledgeId(id)).toBe(true)
    expect(KNOWLEDGE_ID_RE.test(id)).toBe(true)
  })

  it('newBoardId generates brd_ prefix with valid id', () => {
    const id = newBoardId()
    expect(id.startsWith('brd_')).toBe(true)
    expect(isKnowledgeId(id)).toBe(true)
  })

  it('other generators keep prefixes', () => {
    expect(newSpaceId().startsWith('spc_')).toBe(true)
    expect(newFolderId().startsWith('nod_')).toBe(true)
    expect(newDocId().startsWith('doc_')).toBe(true)
  })
})
