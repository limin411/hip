import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

export interface IsolationOpts {
  /** Isolation root directory. Created if missing. */
  root?: string
  /** Prefer :memory: for HIP_DB_PATH. */
  dbMemory?: boolean
  /** When true, set HOME=$root (default for harness / temp isolation). */
  setHome?: boolean
  /** Preserve caller's HIP_AUTH_PATH / user auth; never copy secrets into root. */
  authPath?: string
  env?: NodeJS.ProcessEnv
}

export interface IsolationResult {
  root: string
  env: NodeJS.ProcessEnv
  setHome: boolean
}

const MINIMAL_HIP_TOML = `version = 1
`
const MINIMAL_MEMORY_JSON = JSON.stringify(
  {
    version: 1,
    useMemories: false,
    generateMemories: false,
  },
  null,
  2,
)
const EMPTY_PLUGINS = JSON.stringify({ plugins: [] }, null, 2)

/**
 * Bootstrap full HIP_* isolation matrix (design K13 / K13b).
 * Does not mutate process.env unless caller assigns the returned env.
 */
export function bootstrapIsolation(opts: IsolationOpts = {}): IsolationResult {
  const baseEnv = { ...(opts.env ?? process.env) }
  const setHome = opts.setHome !== false
  const root =
    opts.root?.trim() ||
    baseEnv.HIP_DATA_DIR?.trim() ||
    join(tmpdir(), `hip-run-${randomUUID()}`)

  mkdirSync(join(root, 'config'), { recursive: true })
  mkdirSync(join(root, 'db'), { recursive: true })
  mkdirSync(join(root, 'plugins'), { recursive: true })
  mkdirSync(join(root, 'scratch'), { recursive: true })
  mkdirSync(join(root, 'worktrees'), { recursive: true })
  if (setHome) {
    mkdirSync(join(root, '.hip', 'logs'), { recursive: true })
    mkdirSync(join(root, '.hip', 'plans'), { recursive: true })
  }

  const configToml = join(root, 'config', 'hip.toml')
  if (!existsSync(configToml)) writeFileSync(configToml, MINIMAL_HIP_TOML, 'utf8')
  const memoryJson = join(root, 'config', 'memory.json')
  if (!existsSync(memoryJson)) writeFileSync(memoryJson, MINIMAL_MEMORY_JSON + '\n', 'utf8')
  const pluginsJson = join(root, 'config', 'hip-plugins.json')
  if (!existsSync(pluginsJson)) writeFileSync(pluginsJson, EMPTY_PLUGINS + '\n', 'utf8')

  const authPath =
    opts.authPath?.trim() ||
    baseEnv.HIP_AUTH_PATH?.trim() ||
    // Prefer real user home for secrets even when HOME is redirected.
    join(process.env.HOME && !setHome ? process.env.HOME : homedir(), '.hip', 'config', 'auth.json')

  // When setHome will change HOME, capture the original user home for auth fallback.
  const userHome = process.env.HOME || homedir()
  const resolvedAuth =
    opts.authPath?.trim() ||
    baseEnv.HIP_AUTH_PATH?.trim() ||
    join(userHome, '.hip', 'config', 'auth.json')

  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    HIP_DATA_DIR: root,
    HIP_DB_PATH: opts.dbMemory ? ':memory:' : join(root, 'db', 'hip.db'),
    HIP_CONFIG_PATH: configToml,
    HIP_AUTH_PATH: resolvedAuth || authPath,
    HIP_MEMORY_CONFIG_PATH: memoryJson,
    HIP_PLUGINS_PATH: pluginsJson,
    HIP_PLUGINS_DIR: join(root, 'plugins'),
    HIP_SCRATCH_ROOT: join(root, 'scratch'),
    HIP_WORKTREES_DIR: join(root, 'worktrees'),
  }

  if (setHome) {
    env.HOME = root
  }

  return { root, env, setHome }
}

export function defaultIsolationRoot(): string {
  return join(tmpdir(), `hip-run-${randomUUID()}`)
}
