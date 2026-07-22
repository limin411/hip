import { createRequire } from 'node:module'

export const CLI_VERSION = '1.0.1'

export function resolveSidecarPackageVersion(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require('@hip/sidecar/package.json') as { version?: string }
    return typeof pkg.version === 'string' ? pkg.version : undefined
  } catch {
    return undefined
  }
}
