import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'

/** Env for reading/writing the user's real ~/.hip (session list, interactive). */
export function userHipEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const home = env.HOME?.trim() || homedir()
  const hip = join(home, '.hip')
  const next: NodeJS.ProcessEnv = { ...env }
  if (!next.HIP_DB_PATH?.trim()) {
    next.HIP_DB_PATH = join(hip, 'db', 'hip.db')
  }
  if (!next.HIP_CONFIG_PATH?.trim()) {
    const toml = join(hip, 'config', 'hip.toml')
    if (existsSync(toml)) next.HIP_CONFIG_PATH = toml
  }
  if (!next.HIP_AUTH_PATH?.trim()) {
    next.HIP_AUTH_PATH = join(hip, 'config', 'auth.json')
  }
  if (!next.HIP_MEMORY_CONFIG_PATH?.trim()) {
    const mem = join(hip, 'config', 'memory.json')
    if (existsSync(mem)) next.HIP_MEMORY_CONFIG_PATH = mem
  }
  if (!next.HIP_PLUGINS_PATH?.trim()) {
    const plugins = join(hip, 'config', 'hip-plugins.json')
    if (existsSync(plugins)) next.HIP_PLUGINS_PATH = plugins
  }
  return next
}

export function defaultUserDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.HIP_DB_PATH?.trim() || join(env.HOME?.trim() || homedir(), '.hip', 'db', 'hip.db')
}
