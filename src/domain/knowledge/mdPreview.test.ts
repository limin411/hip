import { describe, expect, it } from 'vitest'
import {
  createHeadingIdAssigner,
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
