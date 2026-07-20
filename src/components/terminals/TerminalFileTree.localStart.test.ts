import { describe, expect, it } from 'vitest'

/**
 * Local tree must seed ls with "." not absolute launch cwd, so macOS /tmp vs
 * /private/tmp (and any realpath rewrite) never hits the jail before canonicalize.
 * Mirrors TerminalFileTree startPath logic for backend=local.
 */
function localStartPath(_initialPath?: string): string {
  return '.'
}

function sftpStartPath(initialPath?: string): string {
  return initialPath?.trim() || '.'
}

describe('TerminalFileTree startPath policy', () => {
  it('local always uses "." regardless of absolute launch cwd', () => {
    expect(localStartPath('/tmp/project')).toBe('.')
    expect(localStartPath('/var/folders/xx/T/proj')).toBe('.')
    expect(localStartPath(undefined)).toBe('.')
    expect(localStartPath('')).toBe('.')
  })

  it('sftp still uses remotePath or "."', () => {
    expect(sftpStartPath('/var/www')).toBe('/var/www')
    expect(sftpStartPath(undefined)).toBe('.')
    expect(sftpStartPath('  ')).toBe('.')
  })
})
