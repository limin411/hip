import { describe, it, expect } from 'vitest'
import {
  collectionViewDisplayName,
  propFieldLabel,
  propOptionLabel,
} from './propDisplay'
import type { CollectionView } from './views'

const t = (key: string) => {
  const map: Record<string, string> = {
    'knowledge.props.status': '状态',
    'knowledge.props.tags': '标签',
    'knowledge.props.options.draft': '草稿',
    'knowledge.props.options.active': '进行中',
    'knowledge.views.defaultAll': '全部',
    'knowledge.views.defaultBoard': '看板',
  }
  return map[key] ?? key
}

describe('propDisplay', () => {
  it('localizes builtin prop keys', () => {
    expect(propFieldLabel(t, 'status')).toBe('状态')
    expect(propFieldLabel(t, 'tags', 'Tags')).toBe('标签')
    expect(propFieldLabel(t, 'custom', 'My field')).toBe('My field')
    expect(propFieldLabel(t, 'custom')).toBe('custom')
  })

  it('localizes known option values', () => {
    expect(propOptionLabel(t, 'draft')).toBe('草稿')
    expect(propOptionLabel(t, 'active')).toBe('进行中')
    expect(propOptionLabel(t, 'published')).toBe('published')
  })

  it('localizes default views only while name is EN default', () => {
    const all: CollectionView = {
      id: 'view_all_table',
      name: 'All',
      filter: { type: 'all' },
      layout: 'table',
    }
    const renamed: CollectionView = {
      id: 'view_all_table',
      name: '我的列表',
      filter: { type: 'all' },
      layout: 'table',
    }
    const board: CollectionView = {
      id: 'view_status_board',
      name: 'Board',
      filter: { type: 'all' },
      layout: 'board',
    }
    expect(collectionViewDisplayName(t, all)).toBe('全部')
    expect(collectionViewDisplayName(t, renamed)).toBe('我的列表')
    expect(collectionViewDisplayName(t, board)).toBe('看板')
  })
})
