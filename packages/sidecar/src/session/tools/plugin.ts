import { writeFileSync, renameSync, existsSync, cpSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { PluginsConfig, PluginRegistryEntry, PluginModelReviewSummary } from '@hip/protocol'
import { readPluginsConfig } from '../../config/plugins.js'
import {
  validatePluginUrl,
  prepareStaging,
  readOrGenerateManifest,
  resolveInstallSlug,
  cleanupStagingDir,
  countComponents,
  type PluginInstallResult,
} from '../plugin-install.js'
import { reviewPluginModels } from '../plugin-model-review.js'

export interface PluginInstallInvokeArgs {
  url: string
  stagingDir?: string
  sha?: string
  ref?: string
  subpath?: string
  marketSourceId?: string
  marketPluginName?: string
  runModelReview?: boolean
  startDisabled?: boolean
}

function writeRegistry(
  pluginsPath: string,
  plugins: string[],
  enabled: Record<string, boolean>,
  entries: PluginRegistryEntry[],
): void {
  const body: PluginsConfig = { plugins, enabled, entries }
  writeFileSync(pluginsPath, JSON.stringify(body, null, 2) + '\n', 'utf8')
}

function readFullRegistry(pluginsPath: string): {
  plugins: string[]
  enabled: Record<string, boolean>
  entries: PluginRegistryEntry[]
} {
  const base = readPluginsConfig()
  let entries: PluginRegistryEntry[] = []
  try {
    const raw = JSON.parse(readFileSync(pluginsPath, 'utf8')) as { entries?: PluginRegistryEntry[] }
    if (Array.isArray(raw.entries)) entries = raw.entries
  } catch {
    /* empty */
  }
  return {
    plugins: base.plugins,
    enabled: { ...(base.enabled ?? {}) },
    entries,
  }
}

export async function installPluginFromArgs(args: PluginInstallInvokeArgs): Promise<PluginInstallResult> {
  const {
    url,
    stagingDir,
    sha,
    ref,
    subpath,
    marketSourceId,
    marketPluginName,
    runModelReview = false,
    startDisabled = false,
  } = args

  const urlErr = validatePluginUrl(url)
  if (urlErr) return { ok: false, error: urlErr }

  const pluginsDir = process.env.HIP_PLUGINS_DIR?.trim()
  if (!pluginsDir) return { ok: false, error: 'HIP_PLUGINS_DIR is not set' }
  const pluginsPath = process.env.HIP_PLUGINS_PATH?.trim()
  if (!pluginsPath) return { ok: false, error: 'HIP_PLUGINS_PATH is not set' }

  let cloneRoot: string | undefined
  let dir: string
  let owned: boolean
  try {
    const staging = prepareStaging(url, pluginsDir, stagingDir, { sha, ref, subpath })
    dir = staging.stagingDir
    owned = staging.owned
    cloneRoot = staging.cloneRoot
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }

  const cleanupAll = () => {
    if (cloneRoot) cleanupStagingDir(cloneRoot)
    else if (owned) cleanupStagingDir(dir)
  }

  let manifest
  try {
    manifest = readOrGenerateManifest(dir, url)
  } catch (err) {
    cleanupAll()
    return { ok: false, error: (err as Error).message }
  }

  let modelReview: PluginModelReviewSummary | undefined
  if (runModelReview) {
    modelReview = reviewPluginModels(dir)
    if (modelReview.status === 'failed') {
      cleanupAll()
      return {
        ok: false,
        error:
          modelReview.findings.find((f) => f.action === 'error')?.message ??
          'Plugin model review failed',
      }
    }
  }

  const existing = readFullRegistry(pluginsPath)
  const existingSet = new Set(existing.plugins)
  let slug: string
  try {
    slug = resolveInstallSlug(manifest.name, pluginsDir, existingSet)
  } catch (err) {
    cleanupAll()
    return { ok: false, error: (err as Error).message }
  }
  const finalDir = join(pluginsDir, slug)

  // Prefer catalog name for registry when provided
  const pluginId = slug

  try {
    const enabled = { ...existing.enabled }
    if (startDisabled) {
      enabled[pluginId] = false
    }
    const entry: PluginRegistryEntry = {
      id: pluginId,
      dir: finalDir,
      marketSourceId,
      marketPluginName: marketPluginName ?? manifest.name,
      installUrl: url,
      installSha: sha,
      installedAt: new Date().toISOString(),
      modelReview,
    }
    const entries = [
      ...existing.entries.filter((e) => e.id !== pluginId),
      entry,
    ]
    writeRegistry(pluginsPath, [...existing.plugins, finalDir], enabled, entries)
  } catch (err) {
    cleanupAll()
    return { ok: false, error: `failed to update plugins config: ${(err as Error).message}` }
  }

  if (owned) {
    try {
      // When stagingDir is nested under cloneRoot, copy nested tree to finalDir
      if (cloneRoot && dir !== cloneRoot) {
        cpSync(dir, finalDir, { recursive: true })
        cleanupStagingDir(cloneRoot)
      } else {
        renameSync(dir, finalDir)
      }
    } catch (err) {
      try {
        const current = readFullRegistry(pluginsPath)
        writeRegistry(
          pluginsPath,
          current.plugins.filter((p) => p !== finalDir),
          current.enabled,
          current.entries.filter((e) => e.id !== pluginId),
        )
      } catch {
        /* best-effort rollback */
      }
      cleanupAll()
      return { ok: false, error: `failed to move plugin into place: ${(err as Error).message}` }
    }
  } else if (!existsSync(finalDir) && existsSync(dir)) {
    // Test seam: staging already provided; copy if not same path
    try {
      if (dir !== finalDir) {
        cpSync(dir, finalDir, { recursive: true })
      }
    } catch (err) {
      return { ok: false, error: `failed to copy plugin: ${(err as Error).message}` }
    }
  }

  // Re-parse after move for accurate component paths
  try {
    const finalManifest = readOrGenerateManifest(finalDir, url)
    const components = countComponents(finalManifest)
    return {
      ok: true,
      pluginId,
      components,
      modelReview,
    }
  } catch {
    const components = countComponents(manifest)
    return { ok: true, pluginId, components, modelReview }
  }
}

export function buildPluginInstallTool(): StructuredToolInterface {
  return tool(
    async (raw: Record<string, unknown>) => {
      const result = await installPluginFromArgs({
        url: String(raw.url ?? ''),
        stagingDir: typeof raw.stagingDir === 'string' ? raw.stagingDir : undefined,
        sha: typeof raw.sha === 'string' ? raw.sha : undefined,
        ref: typeof raw.ref === 'string' ? raw.ref : undefined,
        subpath: typeof raw.subpath === 'string' ? raw.subpath : undefined,
        marketSourceId: typeof raw.marketSourceId === 'string' ? raw.marketSourceId : undefined,
        marketPluginName: typeof raw.marketPluginName === 'string' ? raw.marketPluginName : undefined,
        runModelReview: raw.runModelReview === true,
        startDisabled: raw.startDisabled === true,
      })
      return JSON.stringify(result)
    },
    {
      name: 'plugin_install',
      description:
        'Install a plugin from a git repository URL. Clones the repo, validates or auto-generates ' +
        'the plugin manifest (.plugin/plugin.json), optionally reviews model bindings, and installs ' +
        'into the plugins directory. Returns the installed plugin id and component summary.',
      schema: z
        .object({
          url: z.string(),
          sha: z.string().optional(),
          ref: z.string().optional(),
          subpath: z.string().optional(),
          marketSourceId: z.string().optional(),
          marketPluginName: z.string().optional(),
          runModelReview: z.boolean().optional(),
          startDisabled: z.boolean().optional(),
        })
        .passthrough(),
    },
  )
}

