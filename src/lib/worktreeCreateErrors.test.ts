import { describe, it, expect } from 'vitest'
import { isNonGitWorktreeError } from './worktreeCreateErrors'

describe('isNonGitWorktreeError (D24)', () => {
  it('matches not_a_repo wire code', () => {
    expect(isNonGitWorktreeError('not_a_repo')).toBe(true)
  })

  it('matches common git fatal strings', () => {
    expect(isNonGitWorktreeError('fatal: not a git repository (or any of the parent directories)')).toBe(
      true,
    )
    expect(isNonGitWorktreeError('is not a git directory')).toBe(true)
    expect(isNonGitWorktreeError('path is not a working tree')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isNonGitWorktreeError('NOT_A_REPO')).toBe(true)
    expect(isNonGitWorktreeError('Not A Git Repository')).toBe(true)
  })

  it('does not match unrelated create errors', () => {
    expect(isNonGitWorktreeError('worktree already exists')).toBe(false)
    expect(isNonGitWorktreeError('unsafe branch name: foo')).toBe(false)
    expect(isNonGitWorktreeError('create branch failed')).toBe(false)
    expect(isNonGitWorktreeError('timeout')).toBe(false)
    expect(isNonGitWorktreeError('')).toBe(false)
    expect(isNonGitWorktreeError(null)).toBe(false)
    expect(isNonGitWorktreeError(undefined)).toBe(false)
  })
})
