import { homedir } from 'node:os'
import { join, resolve as pathResolve } from 'node:path'
import { existsSync } from 'node:fs'

/**
 * Resolve hip base dir (must agree with Tauri `paths::hip_base_from` / HIP_DATA_DIR).
 * See design 2026-07-18-hip-cli-tauri-host-attach § Discovery contract.
 */
export function resolveHipBaseDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const dataDir = env.HIP_DATA_DIR?.trim()
  if (dataDir) return pathResolve(dataDir)

  if (platform === 'win32') {
    const appData = env.APPDATA?.trim() || env.LOCALAPPDATA?.trim()
    if (appData) {
      const primary = join(appData, 'com.ljm.hip')
      const alias = join(appData, 'hip')
      if (existsSync(primary)) return primary
      if (existsSync(alias)) return alias
      return primary
    }
    return join(env.USERPROFILE?.trim() || homedir(), 'AppData', 'Roaming', 'com.ljm.hip')
  }

  const home = env.HOME?.trim() || homedir()
  return join(home, '.hip')
}

export function resolveDiscoveryPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(resolveHipBaseDir(env, platform), 'run', 'sidecar.json')
}
