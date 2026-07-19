import type { McpServer } from '@agentclientprotocol/sdk'
import type { McpServerConfig } from '@hip/protocol'
import { resolveEffectiveConfig, resolveAcpHostConfig } from '../../config/hip-config.js'
import { isPluginEnabled, readPluginsConfig } from '../../config/plugins.js'
import { logDebug } from '../../debug-logger.js'
import { parsePluginManifest, PluginManifestError } from '../plugins/parser.js'
import { synthesizePlugin } from '../plugins/synthesizer.js'
import type { AcpAgentRuntimeCaps } from './acp-connection.js'
import { mapHipMcpToAcp } from './acp-mcp-map.js'

/**
 * MCP servers hip would expose on a **builtin** session for this cwd —
 * independent of Session / isExternalAgent / ConfigManager cache.
 *
 * Mirrors `ConfigManager.loadPluginComponents` MCP portion only (no skills/hooks):
 * 1. hip.toml `mcpServers` (global/project merge via resolveEffectiveConfig)
 * 2. Enabled plugins' `synthesizePlugin(...).mcpServers[].config`
 *
 * **Must not** be replaced by `resolveEffectiveConfig(cwd).mcpServers` alone —
 * that API omits plugin-synthesized MCP entries. Also **must not** depend on
 * `configMgr.mcpConfigs` (cleared when the session is external/ACP).
 */
export function listEnabledHipMcpServers(cwd: string): McpServerConfig[] {
  const cfg = resolveEffectiveConfig(cwd)
  const out: McpServerConfig[] = [...(cfg.mcpServers ?? [])]
  try {
    const pluginsCfg = readPluginsConfig()
    for (const pluginDir of pluginsCfg.plugins) {
      if (!isPluginEnabled(pluginDir, pluginsCfg)) continue
      try {
        const manifest = parsePluginManifest(pluginDir)
        const synth = synthesizePlugin(manifest)
        for (const mcp of synth.mcpServers) out.push(mcp.config)
      } catch (e) {
        if (e instanceof PluginManifestError) {
          console.warn(`Skipping invalid plugin: ${e.message}`)
        }
      }
    }
  } catch {
    /* degrade: toml-only */
  }
  return out
}

/**
 * Build ACP `mcpServers` for session/new | loadSession.
 * Returns `[]` when `[acp].forwardMcp` is not true (secure default).
 */
export function buildMcpServersForAcp(cwd: string, caps: AcpAgentRuntimeCaps): McpServer[] {
  const host = resolveAcpHostConfig(cwd)
  if (!host.forwardMcp) return []
  const listed = listEnabledHipMcpServers(cwd)
  const mapped = mapHipMcpToAcp(listed, caps, {
    respectAgentMcpCaps: true,
  })
  logDebug('acp', 'MCP forward', {
    listed: listed.length,
    forwarded: mapped.length,
    loadSession: caps.loadSession,
    mcpHttp: caps.mcp.http,
    mcpSse: caps.mcp.sse,
  })
  return mapped
}
