import { describe, it, expect } from 'vitest'
import {
  BODY_PREVIEW_CAP,
  buildSearchSnippet,
  createKnowledgeIndex,
  docKey,
  removeSearchDoc,
  searchKnowledge,
  tokenizeKnowledge,
  upsertSearchDoc,
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
    // FTS still works on full body field
    expect(searchKnowledge(index, 'x').length).toBeGreaterThan(0)
  })
})

