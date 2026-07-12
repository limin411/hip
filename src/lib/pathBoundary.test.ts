import { describe, it, expect } from 'vitest'
import {
  containingFolderOf,
  isPathUnderRoot,
  normalizeFsPath,
  parentDir,
  relativeToRoot,
} from './pathBoundary'

describe('normalizeFsPath', () => {
  it('collapses separators, dots, and trailing slashes', () => {
    expect(normalizeFsPath('/a//b/./c/')).toBe('/a/b/c')
    expect(normalizeFsPath('a\\b\\c')).toBe('a/b/c')
    expect(normalizeFsPath('/a/b/../c')).toBe('/a/c')
  })

  it('does not escape absolute root via ..', () => {
    expect(normalizeFsPath('/../etc/passwd')).toBe('/etc/passwd')
    expect(normalizeFsPath('/project/../../etc')).toBe('/etc')
  })

  it('normalizes Windows drive paths', () => {
    expect(normalizeFsPath('C:\\Users\\me\\file')).toBe('c:/Users/me/file')
    expect(normalizeFsPath('C:/Users/../Users/x')).toBe('c:/Users/x')
    expect(normalizeFsPath('D:\\')).toBe('d:/')
  })
})

describe('isPathUnderRoot', () => {
  it('accepts root itself and descendants', () => {
    expect(isPathUnderRoot('/project', '/project')).toBe(true)
    expect(isPathUnderRoot('/project/src/a.ts', '/project')).toBe(true)
    expect(isPathUnderRoot('/project/src', '/project')).toBe(true)
  })

  it('rejects sibling prefix attacks (not naive startsWith)', () => {
    expect(isPathUnderRoot('/project-evil', '/project')).toBe(false)
    expect(isPathUnderRoot('/project-evil/x', '/project')).toBe(false)
    expect(isPathUnderRoot('/projectx', '/project')).toBe(false)
  })

  it('rejects paths that escape via .. after normalize', () => {
    expect(isPathUnderRoot('/project/../etc/passwd', '/project')).toBe(false)
    expect(isPathUnderRoot('/project/src/../../outside', '/project')).toBe(false)
  })

  it('rejects empty / missing roots', () => {
    expect(isPathUnderRoot('/a', '')).toBe(false)
    expect(isPathUnderRoot('', '/a')).toBe(false)
  })

  it('handles Windows drive case-insensitively', () => {
    expect(isPathUnderRoot('C:\\proj\\a', 'c:/proj')).toBe(true)
    expect(isPathUnderRoot('C:\\proj-evil', 'c:/proj')).toBe(false)
  })
})

describe('relativeToRoot', () => {
  it('returns . for root and relative segments for children', () => {
    expect(relativeToRoot('/project', '/project')).toBe('.')
    expect(relativeToRoot('/project/src/a.ts', '/project')).toBe('src/a.ts')
  })

  it('returns null outside root', () => {
    expect(relativeToRoot('/other/a', '/project')).toBeNull()
    expect(relativeToRoot('/project-evil/a', '/project')).toBeNull()
  })
})

describe('parentDir / containingFolderOf', () => {
  it('parentDir strips the last segment', () => {
    expect(parentDir('/a/b/c')).toBe('/a/b')
    expect(parentDir('/a')).toBe('/')
    expect(parentDir('c:/Users/x')).toBe('c:/Users')
    expect(parentDir('c:/Users')).toBe('c:/')
  })

  it('containingFolderOf opens parent for files and self for dirs', () => {
    expect(containingFolderOf('/project/src/a.ts', false)).toBe('/project/src')
    expect(containingFolderOf('/project/src', true)).toBe('/project/src')
  })
})
