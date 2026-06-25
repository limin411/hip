import { writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { PluginsConfig } from '@hip/protocol'
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

export function buildPluginInstallTool(): StructuredToolInterface {
  return tool(
    async ({ url, stagingDir }: { url: string; stagingDir?: string }) => {
      const fail = (error: string): string =>
        JSON.stringify({ ok: false, error } satisfies PluginInstallResult)

      try {
        const urlErr = validatePluginUrl(url)
        if (urlErr) return fail(urlErr)

        const pluginsDir = process.env.HIP_PLUGINS_DIR?.trim()
        if (!pluginsDir) return fail('HIP_PLUGINS_DIR is not set')
        const pluginsPath = process.env.HIP_PLUGINS_PATH?.trim()
        if (!pluginsPath) return fail('HIP_PLUGINS_PATH is not set')

        const { stagingDir: dir, owned } = prepareStaging(url, pluginsDir, stagingDir)

        let manifest
        try {
          manifest = readOrGenerateManifest(dir)
        } catch (err) {
          cleanupStagingDir(dir)
          return fail((err as Error).message)
        }

        const existing = readPluginsConfig()
        const existingSet = new Set(existing.plugins)
        let slug: string
        try {
          slug = resolveInstallSlug(manifest.name, pluginsDir, existingSet)
        } catch (err) {
          cleanupStagingDir(dir)
          return fail((err as Error).message)
        }
        const finalDir = join(pluginsDir, slug)

        try {
          const updated: PluginsConfig = { plugins: [...existing.plugins, finalDir] }
          writeFileSync(pluginsPath, JSON.stringify(updated, null, 2), 'utf8')
        } catch (err) {
          cleanupStagingDir(dir)
          return fail(`failed to update plugins config: ${(err as Error).message}`)
        }

        if (owned) {
          try {
            renameSync(dir, finalDir)
          } catch (err) {
            try {
              const current = readPluginsConfig()
              const rolled: PluginsConfig = {
                plugins: current.plugins.filter((p) => p !== finalDir),
              }
              writeFileSync(pluginsPath, JSON.stringify(rolled, null, 2), 'utf8')
            } catch {
              /* best-effort rollback */
            }
            cleanupStagingDir(dir)
            return fail(`failed to move plugin into place: ${(err as Error).message}`)
          }
        }

        const components = countComponents(manifest)

        const result: PluginInstallResult = {
          ok: true,
          pluginId: manifest.id,
          components,
        }
        return JSON.stringify(result)
      } catch (err) {
        return fail((err as Error).message)
      }
    },
    {
      name: 'plugin_install',
      description:
        'Install a plugin from a git repository URL. Clones the repo, validates or auto-generates ' +
        'the plugin manifest (.plugin/plugin.json), and installs it into the plugins directory. ' +
        'Returns the installed plugin id and a summary of its components (skills, mcpServers, agents, hooks).',
      schema: z.object({ url: z.string() }).passthrough(),
    },
  )
}
