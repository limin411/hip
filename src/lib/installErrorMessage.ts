/**
 * Map raw skill/MCP/plugin install errors to user-facing copy keys + detail (Sprint B).
 */

export type InstallErrorKind =
  | 'allowlist'
  | 'permission'
  | 'structure'
  | 'network'
  | 'generic'

export function classifyInstallError(raw: string): InstallErrorKind {
  const s = raw.toLowerCase()
  if (
    s.includes('allowlist') ||
    s.includes('allow-list') ||
    s.includes('not in the allowed') ||
    s.includes('~/.hip/bin') ||
    s.includes('/usr/bin')
  ) {
    return 'allowlist'
  }
  if (
    s.includes('eacces') ||
    s.includes('permission denied') ||
    s.includes('not executable') ||
    s.includes('eperm')
  ) {
    return 'permission'
  }
  if (
    s.includes('skill.md') ||
    (s.includes('missing') && s.includes('zip')) ||
    s.includes('invalid skill') ||
    s.includes('manifest')
  ) {
    return 'structure'
  }
  if (
    s.includes('etimedout') ||
    s.includes('econnrefused') ||
    s.includes('enotfound') ||
    s.includes('network') ||
    s.includes('tls') ||
    s.includes('certificate')
  ) {
    return 'network'
  }
  return 'generic'
}

/** i18n key under settings.installErrors.* */
export function installErrorI18nKey(kind: InstallErrorKind): string {
  return `settings.installErrors.${kind}`
}
