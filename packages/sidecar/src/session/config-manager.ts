import type { SessionConfig, SkillMeta, AgentConfig, McpServerConfig } from '@hip/protocol'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveEffectiveConfig } from '../config/hip-config.js'
import { isPluginEnabled, readPluginsConfig } from '../config/plugins.js'
import { readEnabledSkills, mergeSkills, extractSkillMetaFromData, readEnabledMap } from './skills/registry.js'
import { parseFrontmatter } from './skills/frontmatter.js'
import { parsePluginManifest, PluginManifestError } from './plugins/parser.js'
import { synthesizePlugin } from './plugins/synthesizer.js'
import { HookRegistry } from './hooks/registry.js'

/** Read a plugin skill directory's SKILL.md and build a SkillMeta entry. */
function skillMetaFromDir(dir: string, id: string): SkillMeta | null {
  try {
    const skillMd = join(dir, 'SKILL.md')
    if (!existsSync(skillMd)) return null
    const raw = readFileSync(skillMd, 'utf8')
    const { data } = parseFrontmatter(raw)
    const name = typeof data.name === 'string' ? data.name.trim() : undefined
    if (!name) return null
    const extra = extractSkillMetaFromData(dir, data)
    return { id, name, description: typeof data.description === 'string' ? data.description.trim() : '', dir, ...extra }
  } catch {
    return null
  }
}

export class ConfigManager {
  private cachedSkills: SkillMeta[] | null = null
  private cachedMcpConfigs: McpServerConfig[] | null = null
  private cachedPluginAgents: AgentConfig[] | null = null

  constructor(
    private getConfig: () => SessionConfig,
    private updateConfig: (config: SessionConfig) => void,
    private isRunning: () => boolean,
    private readonly usesEnvModel: boolean,
    private readonly rebuildAgent: () => void,
    private readonly isExternalAgent: () => boolean,
    private getModelDirty: () => boolean,
    private setModelDirty: (v: boolean) => void,
    private readonly hookRegistry: HookRegistry,
  ) {}

  get skills(): SkillMeta[] { return this.cachedSkills ?? [] }
  get mcpConfigs(): McpServerConfig[] { return this.cachedMcpConfigs ?? [] }
  get pluginAgents(): AgentConfig[] { return this.cachedPluginAgents ?? [] }

  /** Load (or reload) per-session plugin components. */
  loadPluginComponents(): void {
    if (this.isExternalAgent()) {
      this.cachedSkills = []
      this.cachedMcpConfigs = []
      this.cachedPluginAgents = []
      return
    }
    this.hookRegistry.clear()
    const cwd = this.getConfig().cwd ?? process.cwd()
    const cfg = resolveEffectiveConfig(cwd)
    try { this.cachedSkills = readEnabledSkills(this.getConfig().cwd, cfg) } catch { this.cachedSkills = [] }
    this.cachedMcpConfigs = cfg.mcpServers ?? []
    const enabled = readEnabledMap(cwd, cfg)
    const pluginAgents: AgentConfig[] = []
    try {
      const pluginsCfg = readPluginsConfig()
      for (const pluginDir of pluginsCfg.plugins) {
        if (!isPluginEnabled(pluginDir, pluginsCfg)) continue
        try {
          const manifest = parsePluginManifest(pluginDir)
          const synth = synthesizePlugin(manifest)
          const pluginSkills: SkillMeta[] = []
          for (const se of synth.skills) {
            if (enabled[se.id] === false) continue
            const meta = skillMetaFromDir(se.dir, se.id)
            if (meta) pluginSkills.push(meta)
          }
          if (pluginSkills.length > 0) this.cachedSkills = mergeSkills(this.cachedSkills!, pluginSkills)
          for (const mcp of synth.mcpServers) this.cachedMcpConfigs!.push(mcp.config)
          for (const agent of synth.agents) pluginAgents.push(agent.config)
          for (const hookEntry of synth.hooks) {
            for (const hook of hookEntry.hooks) {
              this.hookRegistry.register(hook)
            }
          }
        } catch (e) {
          if (e instanceof PluginManifestError) {
            console.warn(`Skipping invalid plugin: ${e.message}`)
          }
        }
      }
    } catch { /* degrade: skip plugins */ }
    this.cachedPluginAgents = pluginAgents
  }

  /** Reload plugin components after config changes. */
  reloadPlugins(): void {
    this.cachedSkills = null
    this.cachedMcpConfigs = null
    this.cachedPluginAgents = null
    this.loadPluginComponents()
  }

  /** Bind/replace the project directory and rebuild the agent. Empty string clears cwd. */
  setCwd(cwd: string): void {
    const next = cwd.trim()
    if (!next) {
      const { cwd: _cleared, ...rest } = this.getConfig()
      this.updateConfig(rest)
    } else {
      this.updateConfig({ ...this.getConfig(), cwd: next })
    }
    this.reloadPlugins()
    this.rebuildAgent()
  }

  /** Toggle the thinking (reasoner) model. NO-OP (returns false) while a turn is running. */
  setThinking(thinking: boolean): boolean {
    if (this.isRunning()) return false
    this.updateConfig({ ...this.getConfig(), thinking })
    this.rebuildAgent()
    return true
  }

  /**
   * Set reasoning effort / thinking intensity for the session model.
   * Pass null to clear (provider default). NO-OP while a turn is running.
   */
  setEffort(effort: string | null): boolean {
    if (this.isRunning()) return false
    const next = effort?.trim() || undefined
    this.updateConfig({ ...this.getConfig(), effort: next })
    this.rebuildAgent()
    return true
  }

  /** Set the per-conversation permission mode. NO-OP (returns false) while a turn is running. */
  setPermissionMode(permissionMode: SessionConfig['permissionMode']): boolean {
    if (this.isRunning()) return false
    this.updateConfig({ ...this.getConfig(), permissionMode } as SessionConfig)
    return true
  }

  /** Force plan/execute/verify loop for subsequent turns. NO-OP while a turn is running. */
  setForcePlan(forcePlan: boolean): boolean {
    if (this.isRunning()) return false
    this.updateConfig({
      ...this.getConfig(),
      forcePlan,
      // forcePlan wins over a lingering disablePlan from CLI presets
      ...(forcePlan ? { disablePlan: false } : {}),
    } as SessionConfig)
    return true
  }

  /** Rebuild against the current global active model. */
  applyActiveModel(): boolean {
    if (!this.usesEnvModel) return true
    if (this.isRunning()) { this.setModelDirty(true); return false }
    this.rebuildAgent()
    return true
  }

  /** Clear the session's pinned model so it follows the global active model. */
  setModel(llmProvider: string): boolean {
    if (!this.usesEnvModel) return true
    if (this.isRunning()) { this.setModelDirty(true); return false }
    this.updateConfig({ ...this.getConfig(), llmProvider, model: '' })
    this.rebuildAgent()
    return true
  }

  /** Set/clear per-conversation instructions and rebuild the agent. */
  setSystemPrompt(systemPrompt: string | null): boolean {
    if (this.isRunning()) return false
    const next = systemPrompt?.trim() || undefined
    this.updateConfig({ ...this.getConfig(), systemPrompt: next })
    this.rebuildAgent()
    return true
  }
}
