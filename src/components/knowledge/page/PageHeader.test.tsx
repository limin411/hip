// @vitest-environment happy-dom
/**
 * doc-ux-polish-2 X5: 标题 hover ⋯ 入口延迟 ≤100ms（防误触）。
 * 页面菜单随标题区 hover 即显，transition 时长 100ms，无 300ms 级延迟。
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageHeader } from './PageHeader'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN' },
  }),
}))

vi.mock('../InlineDocTitle', () => ({
  InlineDocTitle: () => <div data-testid="inline-title" />,
}))

describe('PageHeader 标题 hover ⋯ 入口（X5）', () => {
  it('页面菜单随标题区 group-hover 显隐，过渡时长 ≤100ms', () => {
    render(
      <PageHeader
        docId="doc_1"
        title="Test"
        onTitleCommit={() => {}}
        menu={<button type="button">⋯</button>}
      />,
    )
    const menuWrap = screen.getByRole('button', { name: '⋯' }).parentElement!
    // 静止隐藏（opacity-0）+ group-hover 显隐
    expect(menuWrap.className).toContain('opacity-0')
    expect(menuWrap.className).toContain('group-hover:opacity-100')
    // 过渡时长 100ms（duration-100），无 delay-*
    expect(menuWrap.className).toContain('duration-100')
    expect(menuWrap.className).not.toMatch(/delay-\d+/)
    expect(menuWrap.className).not.toContain('duration-300')
  })
})
