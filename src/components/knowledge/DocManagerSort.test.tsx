// @vitest-environment happy-dom
/**
 * 文档管理（主区浏览 + 侧边栏）层级排序：文件夹优先，目录与文件各自按名称升序，
 * 与更新时间无关。
 */
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import { DocManagerBrowse } from './DocManagerBrowse'
import { DirNavList } from './DirNavList'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

vi.mock('@/ipc/knowledge', () => ({
  knowledgeRevealDoc: vi.fn(),
}))

vi.mock('@/components/context-menu', () => ({
  DeclarativeContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

function node(
  id: string,
  kind: KnowledgeNode['kind'],
  title: string,
  updatedAt: number,
): KnowledgeNode {
  return { id, parentId: null, kind, title, order: 0, createdAt: 1, updatedAt }
}

/**
 * updatedAt 故意与名称序相反：
 * 名称序 → Alpha, Beta, AlphaDoc, Zulu
 * 更新时间倒序 → Zulu(500), Beta(400), Alpha(300), AlphaDoc(100)
 */
const MIXED_NODES = [
  node('doc_z', 'doc', 'Zulu', 500),
  node('nod_b', 'folder', 'Beta', 400),
  node('doc_a', 'doc', 'AlphaDoc', 100),
  node('nod_a', 'folder', 'Alpha', 300),
]

describe('DocManagerBrowse 排序', () => {
  beforeEach(() => {
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [],
      activeSpaceId: null,
      nodes: MIXED_NODES,
      currentFolderId: null,
      activeDocId: null,
      busy: false,
    })
  })

  afterEach(() => cleanup())

  it('文件夹在前，目录与文件各自按名称升序', () => {
    render(<DocManagerBrowse />)
    const tiles = screen
      .getAllByTestId(/^browse-tile-/)
      .map((el) => el.getAttribute('data-testid'))
    expect(tiles).toEqual([
      'browse-tile-nod_a',
      'browse-tile-nod_b',
      'browse-tile-doc_a',
      'browse-tile-doc_z',
    ])
  })
})

describe('DirNavList 排序', () => {
  beforeEach(() => {
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [],
      activeSpaceId: null,
      nodes: MIXED_NODES,
      currentFolderId: null,
      activeDocId: null,
      busy: false,
    })
  })

  afterEach(() => cleanup())

  it('文件夹在前，目录与文件各自按名称升序', () => {
    render(<DirNavList />)
    const rows = screen
      .getAllByTestId(/^dir-row-/)
      .map((el) => el.getAttribute('data-testid'))
    expect(rows).toEqual([
      'dir-row-nod_a',
      'dir-row-nod_b',
      'dir-row-doc_a',
      'dir-row-doc_z',
    ])
  })
})
