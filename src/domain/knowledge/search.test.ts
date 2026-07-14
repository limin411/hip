import { describe, it, expect } from 'vitest'
import { KNOWLEDGE_INDEX_BODY_CHARS } from './limits'
import {
  BODY_PREVIEW_CAP,
  buildSearchSnippet,
  capIndexBody,
  createKnowledgeIndex,
  docKey,
  groupSearchHitsBySpace,
  removeSearchDoc,
  searchKnowledge,
  tokenizeKnowledge,
  upsertSearchDoc,
  type KnowledgeSearchHit,
} from './search'

describe('knowledge MiniSearch helper', () => {
  it('tokenizes latin words and CJK characters', () => {
    expect(tokenizeKnowledge('hello 白名单')).toEqual(
      expect.arrayContaining(['hello', '白', '名', '单']),
    )
  })

  it('finds docs by body and title (CJK + latin)', () => {
    const index = createKnowledgeIndex()
    upsertSearchDoc(index, {
      id: docKey('spc_a', 'doc_1'),
      spaceId: 'spc_a',
      docId: 'doc_1',
      title: '权限模型',
      body: '会话级权限与工具白名单 allowlist',
      spaceName: '产品',
      path: '决策 / 权限模型',
    })
    upsertSearchDoc(index, {
      id: docKey('spc_a', 'doc_2'),
      spaceId: 'spc_a',
      docId: 'doc_2',
      title: '其它',
      body: '无关内容',
      spaceName: '产品',
      path: '其它',
    })

    const byBody = searchKnowledge(index, '白名单')
    expect(byBody.some((h) => h.docId === 'doc_1')).toBe(true)

    const byLatin = searchKnowledge(index, 'allowlist')
    expect(byLatin.some((h) => h.docId === 'doc_1')).toBe(true)

    const byTitle = searchKnowledge(index, '权限')
    expect(byTitle[0]?.docId).toBe('doc_1')
  })

  it('upsert and remove keep the index consistent', () => {
    const index = createKnowledgeIndex()
    const id = docKey('spc_a', 'doc_1')
    upsertSearchDoc(index, {
      id,
      spaceId: 'spc_a',
      docId: 'doc_1',
      title: 'v1',
      body: 'alpha',
      spaceName: 'S',
      path: 'v1',
    })
    upsertSearchDoc(index, {
      id,
      spaceId: 'spc_a',
      docId: 'doc_1',
      title: 'v2',
      body: 'beta unique_token',
      spaceName: 'S',
      path: 'v2',
    })
    expect(searchKnowledge(index, 'alpha')).toHaveLength(0)
    expect(searchKnowledge(index, 'unique_token')[0]?.title).toBe('v2')
    removeSearchDoc(index, id)
    expect(searchKnowledge(index, 'unique_token')).toHaveLength(0)
  })

  it('returns snippet from bodyPreview for body hits', () => {
    const index = createKnowledgeIndex()
    upsertSearchDoc(index, {
      id: docKey('spc_a', 'doc_1'),
      spaceId: 'spc_a',
      docId: 'doc_1',
      title: 'Note',
      body: 'prefix unique_snippet_token suffix more text',
      spaceName: 'S',
      path: 'Note',
    })
    const hits = searchKnowledge(index, 'unique_snippet_token')
    expect(hits[0]?.snippet).toContain('unique_snippet_token')
  })

  it('buildSearchSnippet falls back to leading excerpt when no token in preview', () => {
    const preview = 'alpha beta gamma delta epsilon zeta'
    expect(buildSearchSnippet(preview, 'zzzz-not-found')).toMatch(/^alpha/)
  })

  it('buildSearchSnippet omits empty preview', () => {
    expect(buildSearchSnippet('', 'x')).toBeUndefined()
  })

  it('caps bodyPreview length', () => {
    const long = 'x'.repeat(BODY_PREVIEW_CAP + 50)
    const index = createKnowledgeIndex()
    upsertSearchDoc(index, {
      id: docKey('spc_a', 'doc_1'),
      spaceId: 'spc_a',
      docId: 'doc_1',
      title: 'Long',
      body: long,
      spaceName: 'S',
      path: 'Long',
    })
    // FTS still works on body field (capped for index)
    expect(searchKnowledge(index, 'x').length).toBeGreaterThan(0)
  })

  it('capIndexBody trims to KNOWLEDGE_INDEX_BODY_CHARS', () => {
    const long = 'a'.repeat(KNOWLEDGE_INDEX_BODY_CHARS + 100)
    expect(capIndexBody(long).length).toBe(KNOWLEDGE_INDEX_BODY_CHARS)
    expect(capIndexBody('short')).toBe('short')
  })

  it('upsertSearchDoc indexes only capped body (deep tail not searchable)', () => {
    const marker = 'unique_tail_token_xyz'
    const body = `${'z'.repeat(KNOWLEDGE_INDEX_BODY_CHARS)}${marker}`
    const index = createKnowledgeIndex()
    upsertSearchDoc(index, {
      id: docKey('spc_a', 'doc_1'),
      spaceId: 'spc_a',
      docId: 'doc_1',
      title: 'Huge',
      body,
      spaceName: 'S',
      path: 'Huge',
    })
    expect(searchKnowledge(index, marker)).toHaveLength(0)
    // Head of body still searchable
    expect(searchKnowledge(index, 'z').length).toBeGreaterThan(0)
  })

  it('groupSearchHitsBySpace preserves first-seen space order and hit order', () => {
    const hits: KnowledgeSearchHit[] = [
      {
        spaceId: 'spc_b',
        docId: 'doc_1',
        title: 'B1',
        spaceName: 'Beta',
        path: 'B1',
        score: 10,
      },
      {
        spaceId: 'spc_a',
        docId: 'doc_2',
        title: 'A1',
        spaceName: 'Alpha',
        path: 'A1',
        score: 9,
      },
      {
        spaceId: 'spc_b',
        docId: 'doc_3',
        title: 'B2',
        spaceName: 'Beta',
        path: 'B2',
        score: 8,
      },
    ]
    const groups = groupSearchHitsBySpace(hits)
    expect(groups.map((g) => g.spaceId)).toEqual(['spc_b', 'spc_a'])
    expect(groups[0]?.hits.map((h) => h.docId)).toEqual(['doc_1', 'doc_3'])
    expect(groups[1]?.hits.map((h) => h.docId)).toEqual(['doc_2'])
    expect(groups[0]?.spaceName).toBe('Beta')
  })
})

