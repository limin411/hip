import { describe, expect, it } from 'vitest'
import {
  isKnowledgeId,
  KNOWLEDGE_ID_RE,
  newBoardId,
  newDocId,
  newFolderId,
  newSpaceId,
} from './ids'

describe('knowledge ids', () => {
  it('accepts brd_ prefix in KNOWLEDGE_ID_RE', () => {
    expect(KNOWLEDGE_ID_RE.test('brd_xxxxxxxxxxxx')).toBe(true)
    expect(isKnowledgeId('brd_board0001')).toBe(true)
    expect(isKnowledgeId('doc_abc123def456')).toBe(true)
    expect(isKnowledgeId('nod_folder001')).toBe(true)
    expect(isKnowledgeId('spc_xYzAbCdEfGhI')).toBe(true)
  })

  it('rejects illegal ids', () => {
    expect(isKnowledgeId('')).toBe(false)
    expect(isKnowledgeId('foo_bar')).toBe(false)
    expect(isKnowledgeId('brd_ab')).toBe(false)
    expect(isKnowledgeId('brd_../evil')).toBe(false)
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
