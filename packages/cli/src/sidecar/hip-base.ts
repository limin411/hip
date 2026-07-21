import { homedir } from 'node:os'
import { join, resolve as pathResolve } from 'node:path'

/**
 * Resolve hip base dir (must agree with Tauri `paths::hip_base_from` / HIP_DATA_DIR).
 * All platforms use `$HOME/.hip` (Windows: `%USERPROFILE%\.hip`).
 * See design 2026-07-21-windows-plugin-load-reliability § D1.
 */
export function resolveHipBaseDir(
  env: NodeJS.ProcessEnv = process.env,
  _platform: NodeJS.Platform = process.platform,
): string {
  const dataDir = env.HIP_DATA_DIR?.trim()
  if (dataDir) return pathResolve(dataDir)

  const home =
    env.HOME?.trim() ||
    env.USERPROFILE?.trim() ||
    homedir()
  return join(home, '.hip')
}

export function resolveDiscoveryPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(resolveHipBaseDir(env, platform), 'run', 'sidecar.json')
}
