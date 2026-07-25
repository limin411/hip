import { describe, it, expect } from 'vitest'
import { highlightLangFromPath, isHighlightableCodePath } from './previewLang'

describe('highlightLangFromPath', () => {
  it('maps common source extensions', () => {
    expect(highlightLangFromPath('/a/main.ts')).toBe('typescript')
    expect(highlightLangFromPath('/a/App.tsx')).toBe('tsx')
    expect(highlightLangFromPath('/a/index.js')).toBe('javascript')
    expect(highlightLangFromPath('/a/util.py')).toBe('python')
    expect(highlightLangFromPath('/a/lib.rs')).toBe('rust')
    expect(highlightLangFromPath('/a/main.go')).toBe('go')
    expect(highlightLangFromPath('/a/Main.kt')).toBe('kotlin')
    expect(highlightLangFromPath('/a/run.sh')).toBe('bash')
  })

  it('maps Dockerfile basename without extension', () => {
    expect(highlightLangFromPath('/repo/Dockerfile')).toBe('dockerfile')
  })

  it('returns null for unknown extensions', () => {
    expect(highlightLangFromPath('/a/blob.dat')).toBeNull()
    expect(highlightLangFromPath('/a/noext')).toBeNull()
  })

  it('isHighlightableCodePath mirrors non-null lang', () => {
    expect(isHighlightableCodePath('/a/x.ts')).toBe(true)
    expect(isHighlightableCodePath('/a/x.unknown')).toBe(false)
  })
})
