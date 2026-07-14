import { CLI_VERSION, resolveSidecarPackageVersion } from '../version.js'

export function printVersion(): void {
  const sc = resolveSidecarPackageVersion()
  if (sc) {
    process.stdout.write(`hip ${CLI_VERSION} (sidecar ${sc})\n`)
  } else {
    process.stdout.write(`hip ${CLI_VERSION}\n`)
  }
}
