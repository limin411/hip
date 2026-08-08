// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import {
  findRevealElementInRoot,
  findRevealMatch,
  findRevealOffset,
  revealHeadingInRoot,
  revealInPreviewRoot,
} from './searchReveal'

describe('findRevealMatch', () => {
  it('finds full query case-insensitively with full length', () => {
    expect(findRevealMatch('Hello UniqueToken world', 'uniquetoken')).toEqual({
      offset: 6,
      length: 'uniquetoken'.length,
    })
  })

  it('token fallback uses token length, not full query length', () => {
    const text = 'alpha beta gamma'
    // Multi-token query; only "beta" present as contiguous match
    expect(findRevealMatch(text, 'zzz beta')).toEqual({
      offset: 6,
      length: 'beta'.length,
    })
  })

  it('returns null when nothing matches', () => {
    expect(findRevealMatch('hello world', 'nomatch')).toBeNull()
  })

  it('returns null for empty query or text', () => {
    expect(findRevealMatch('', 'x')).toBeNull()
    expect(findRevealMatch('hello', '  ')).toBeNull()
  })

  it('finds CJK character tokens with correct length', () => {
    expect(findRevealMatch('会话级权限', '权限')).toEqual({ offset: 3, length: 2 })
  })

  it('findRevealOffset mirrors match.offset', () => {
    expect(findRevealOffset('Hello UniqueToken world', 'uniquetoken')).toBe(6)
    expect(findRevealOffset('hello', 'nomatch')).toBeNull()
  })
})

describe('revealHeadingInRoot', () => {
  it('scrolls the matching occurrence by text', () => {
    const root = document.createElement('div')
    root.innerHTML = '<h1>A</h1><h2>B</h2><h2>B</h2>'
    const h2s = root.querySelectorAll('h2')
    const first = vi.fn()
    const second = vi.fn()
    ;(h2s[0] as HTMLElement).scrollIntoView = first
    ;(h2s[1] as HTMLElement).scrollIntoView = second

    expect(revealHeadingInRoot(root, 'B', 0)).toBe(true)
    expect(first).toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()

    first.mockClear()
    expect(revealHeadingInRoot(root, 'B', 1)).toBe(true)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalled()
  })

  it('returns false when no heading matches', () => {
    const root = document.createElement('div')
    root.innerHTML = '<h1>Only</h1>'
    expect(revealHeadingInRoot(root, 'Missing')).toBe(false)
  })
})

describe('findRevealElementInRoot / revealInPreviewRoot', () => {
  it('scrolls the first matching text node parent and returns it', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>intro text</p><p>harness core ability</p><p>tail</p>'
    const target = root.querySelectorAll('p')[1] as HTMLElement
    const scroll = vi.fn()
    target.scrollIntoView = scroll

    const el = findRevealElementInRoot(root, 'harness')
    expect(el).toBe(target)
    expect(scroll).toHaveBeenCalled()
    expect(revealInPreviewRoot(root, 'harness')).toBe(true)
  })

  it('falls back to token match (CJK single char) and returns the element', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>评测与数据闭环</p>'
    const el = findRevealElementInRoot(root, '评测体系')
    expect(el).not.toBeNull()
    expect(el!.textContent).toBe('评测与数据闭环')
  })

  it('returns null when nothing matches', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>nothing here</p>'
    expect(findRevealElementInRoot(root, 'zzz-missing')).toBeNull()
    expect(revealInPreviewRoot(root, 'zzz-missing')).toBe(false)
  })

  it('returns null for empty query', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>x</p>'
    expect(findRevealElementInRoot(root, '  ')).toBeNull()
  })
})
