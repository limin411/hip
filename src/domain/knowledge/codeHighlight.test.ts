import { describe, expect, it } from 'vitest'
import {
  HIGHLIGHT_LANG_ALIASES,
  KNOWLEDGE_HIGHLIGHT_LANGS,
  normalizeHighlightLang,
} from './codeHighlight'

describe('normalizeHighlightLang', () => {
  it('returns null for empty / missing', () => {
    expect(normalizeHighlightLang(undefined)).toBeNull()
    expect(normalizeHighlightLang(null)).toBeNull()
    expect(normalizeHighlightLang('')).toBeNull()
    expect(normalizeHighlightLang('   ')).toBeNull()
  })

  it('maps common aliases to canonical ids', () => {
    expect(normalizeHighlightLang('ts')).toBe('typescript')
    expect(normalizeHighlightLang('TS')).toBe('typescript')
    expect(normalizeHighlightLang('js')).toBe('javascript')
    expect(normalizeHighlightLang('py')).toBe('python')
    expect(normalizeHighlightLang('rs')).toBe('rust')
    expect(normalizeHighlightLang('sh')).toBe('bash')
    expect(normalizeHighlightLang('shell')).toBe('bash')
    expect(normalizeHighlightLang('yml')).toBe('yaml')
    expect(normalizeHighlightLang('md')).toBe('markdown')
    expect(normalizeHighlightLang('cs')).toBe('csharp')
    expect(normalizeHighlightLang('c#')).toBe('csharp')
    expect(normalizeHighlightLang('c++')).toBe('cpp')
  })

  it('does not map plain text fences to markdown', () => {
    expect(normalizeHighlightLang('text')).toBeNull()
    expect(HIGHLIGHT_LANG_ALIASES.text).toBeUndefined()
  })

  it('accepts canonical allowlist ids', () => {
    for (const id of ['typescript', 'python', 'rust', 'go', 'sql', 'json']) {
      expect(normalizeHighlightLang(id)).toBe(id)
    }
  })

  it('trims whitespace', () => {
    expect(normalizeHighlightLang('  ts  ')).toBe('typescript')
  })

  it('returns null for unknown langs (no toast side effects)', () => {
    expect(normalizeHighlightLang('mermaid')).toBeNull()
    expect(normalizeHighlightLang('svg')).toBeNull()
    expect(normalizeHighlightLang('brainfuck')).toBeNull()
    expect(normalizeHighlightLang('not-a-lang')).toBeNull()
  })

  it('alias targets are on the allowlist', () => {
    for (const target of Object.values(HIGHLIGHT_LANG_ALIASES)) {
      expect(KNOWLEDGE_HIGHLIGHT_LANGS).toContain(target)
    }
  })

  it('allowlist is non-empty and includes core set', () => {
    expect(KNOWLEDGE_HIGHLIGHT_LANGS.length).toBeGreaterThan(10)
    for (const id of [
      'typescript',
      'javascript',
      'tsx',
      'jsx',
      'python',
      'rust',
      'go',
      'bash',
      'json',
      'yaml',
      'css',
      'html',
      'sql',
    ]) {
      expect(KNOWLEDGE_HIGHLIGHT_LANGS).toContain(id)
    }
  })
})
