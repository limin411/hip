import { describe, it, expect } from 'vitest'
import { resolveSearchRoot } from './resolveSearchRoot'

describe('resolveSearchRoot', () => {
  it('returns project session cwd when path ok or unknown', () => {
    expect(
      resolveSearchRoot({
        sessionConfig: { surface: 'code', cwd: '/proj' },
        pathStatus: 'ok',
      }),
    ).toBe('/proj')
    expect(
      resolveSearchRoot({
        sessionConfig: { workspaceMode: 'project', cwd: '/proj' },
        pathStatus: 'unknown',
      }),
    ).toBe('/proj')
  })

  it('returns null when path missing', () => {
    expect(
      resolveSearchRoot({
        sessionConfig: { surface: 'code', cwd: '/gone' },
        pathStatus: 'missing',
      }),
    ).toBeNull()
  })

  it('never uses chat/sandbox (including scratch cwd)', () => {
    expect(
      resolveSearchRoot({
        sessionConfig: { surface: 'chat', cwd: '/Users/x/.hip/scratch/s1' },
        pathStatus: 'ok',
      }),
    ).toBeNull()
    expect(
      resolveSearchRoot({
        sessionConfig: { workspaceMode: 'sandbox', cwd: '/tmp/scratch' },
        pathStatus: 'ok',
      }),
    ).toBeNull()
  })

  it('prefers explicit workspaceMode over surface', () => {
    expect(
      resolveSearchRoot({
        sessionConfig: { surface: 'chat', workspaceMode: 'project', cwd: '/proj' },
        pathStatus: 'ok',
      }),
    ).toBe('/proj')
  })

  it('draft requires mode=project and cwd', () => {
    expect(
      resolveSearchRoot({
        draft: { mode: 'project', cwd: '/draft-proj' },
        pathStatus: 'ok',
      }),
    ).toBe('/draft-proj')
    expect(
      resolveSearchRoot({
        draft: { mode: 'chat', cwd: '/ignored' },
        pathStatus: 'ok',
      }),
    ).toBeNull()
    expect(
      resolveSearchRoot({
        draft: { mode: 'project' },
        pathStatus: 'ok',
      }),
    ).toBeNull()
  })

  it('sessionConfig takes precedence over draft when provided', () => {
    // Callers pass only one of session/draft; if both, session wins.
    expect(
      resolveSearchRoot({
        sessionConfig: { surface: 'code', cwd: '/session' },
        draft: { mode: 'project', cwd: '/draft' },
        pathStatus: 'ok',
      }),
    ).toBe('/session')
  })
})
