import * as fs from 'node:fs'
import * as path from 'node:path'
import type { PackManifest, TaskSpec } from './types.js'

function readJson<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(raw) as T
}

function mergeTask(defaults: PackManifest['defaults'] | undefined, task: TaskSpec): TaskSpec {
  if (!defaults) return task
  return {
    ...task,
    workspace: { ...defaults.workspace, ...task.workspace },
    ui: { ...defaults.ui, ...task.ui },
    verify: {
      ...defaults.verify,
      ...task.verify,
      commands: task.verify?.commands ?? defaults.verify?.commands,
      soft: task.verify?.soft ?? defaults.verify?.soft,
    },
  }
}

/** Load a single task JSON (absolute or relative path). */
export function loadTask(taskPath: string): TaskSpec {
  const abs = path.resolve(taskPath)
  if (!fs.existsSync(abs)) {
    throw new Error(`task file not found: ${abs}`)
  }
  const task = readJson<TaskSpec>(abs)
  if (task.schemaVersion !== 1) {
    throw new Error(`unsupported task schemaVersion: ${String(task.schemaVersion)}`)
  }
  if (!task.id || !task.prompt) {
    throw new Error(`task missing id/prompt: ${abs}`)
  }
  if (!task.workspace) {
    throw new Error(`task missing workspace: ${abs}`)
  }
  if (!task.ui) {
    task.ui = {}
  }
  return task
}

export interface LoadedPack {
  pack: PackManifest
  packDir: string
  tasks: TaskSpec[]
}

/** Load pack.json and all task files. */
export function loadPack(packPath: string): LoadedPack {
  const abs = path.resolve(packPath)
  const packDir = fs.statSync(abs).isDirectory() ? abs : path.dirname(abs)
  const manifestPath = fs.statSync(abs).isDirectory() ? path.join(abs, 'pack.json') : abs
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`pack manifest not found: ${manifestPath}`)
  }
  const pack = readJson<PackManifest>(manifestPath)
  if (pack.schemaVersion !== 1) {
    throw new Error(`unsupported pack schemaVersion: ${String(pack.schemaVersion)}`)
  }
  const tasks = pack.tasks.map((rel) => {
    const taskPath = path.join(packDir, rel)
    return mergeTask(pack.defaults, loadTask(taskPath))
  })
  return { pack, packDir, tasks }
}

export function resolveTaskRepoPath(task: TaskSpec): string {
  if (task.workspace.repo_path) {
    return path.resolve(task.workspace.repo_path)
  }
  const envName = task.workspace.repo_path_env
  if (envName) {
    const v = process.env[envName]
    if (!v) {
      throw new Error(`env ${envName} not set (needed for task ${task.id})`)
    }
    return path.resolve(v)
  }
  throw new Error(`task ${task.id}: workspace.repo_path or repo_path_env required`)
}

/** Resolve a fixture path relative to pack dir or task file dir. */
export function resolvePackRelative(packDir: string, rel: string): string {
  return path.resolve(packDir, rel)
}
