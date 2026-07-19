import { describe, expect, it } from 'vitest'
import {
  createHeadingIdAssigner,
  extractDocOutline,
  headingIdsBySourceLine,
  normalizeHeadingHash,
  slugifyHeading,
} from './mdPreview'

describe('slugifyHeading', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugifyHeading('Hello World')).toBe('hello-world')
  })

  it('strips punctuation but keeps CJK', () => {
    expect(slugifyHeading('Hello, World!')).toBe('hello-world')
    expect(slugifyHeading('中文标题')).toBe('中文标题')
    expect(slugifyHeading('Mixed 中文 Title')).toBe('mixed-中文-title')
  })

  it('collapses whitespace and hyphens', () => {
    expect(slugifyHeading('  a   b--c  ')).toBe('a-b-c')
  })

  it('falls back for empty / symbol-only text', () => {
    expect(slugifyHeading('')).toBe('heading')
    expect(slugifyHeading('***')).toBe('heading')
  })
})

describe('createHeadingIdAssigner', () => {
  it('uniquifies duplicate headings', () => {
    const id = createHeadingIdAssigner()
    expect(id('Intro')).toBe('intro')
    expect(id('Intro')).toBe('intro-1')
    expect(id('Intro')).toBe('intro-2')
    expect(id('Other')).toBe('other')
  })
})

describe('normalizeHeadingHash', () => {
  it('strips leading # and decodes URI', () => {
    expect(normalizeHeadingHash('#hello-world')).toBe('hello-world')
    expect(normalizeHeadingHash('hello-world')).toBe('hello-world')
    expect(normalizeHeadingHash('#caf%C3%A9')).toBe('café')
  })
})

describe('extractDocOutline', () => {
  it('returns level, text, id, and 1-based line in order', () => {
    const md = '# Top\n\n## Nested\n\n### Deep\n'
    expect(extractDocOutline(md)).toEqual([
      { id: 'top', level: 1, text: 'Top', line: 1 },
      { id: 'nested', level: 2, text: 'Nested', line: 3 },
      { id: 'deep', level: 3, text: 'Deep', line: 5 },
    ])
  })

  it('uniquifies duplicate titles and skips fenced code', () => {
    const md = '## Intro\n```\n## Fake\n```\n## Intro\n'
    expect(extractDocOutline(md)).toEqual([
      { id: 'intro', level: 2, text: 'Intro', line: 1 },
      { id: 'intro-1', level: 2, text: 'Intro', line: 5 },
    ])
  })

  it('keeps CJK heading text', () => {
    expect(extractDocOutline('## 中文标题\n')).toEqual([
      { id: '中文标题', level: 2, text: '中文标题', line: 1 },
    ])
  })
})

describe('headingIdsBySourceLine', () => {
  it('maps 1-based ATX lines to unique ids', () => {
    const md = '## Intro\n\n## Intro\n\n# Other\n'
    const map = headingIdsBySourceLine(md)
    expect(map.get(1)).toBe('intro')
    expect(map.get(3)).toBe('intro-1')
    expect(map.get(5)).toBe('other')
    expect(map.size).toBe(3)
  })

  it('skips headings inside fenced code', () => {
    const md = '## Real\n```\n## Fake\n```\n## After\n'
    const map = headingIdsBySourceLine(md)
    expect([...map.values()]).toEqual(['real', 'after'])
    expect(map.get(1)).toBe('real')
    expect(map.get(5)).toBe('after')
  })

  it('keeps CJK heading text', () => {
    expect(headingIdsBySourceLine('## 中文标题\n').get(1)).toBe('中文标题')
  })
})
