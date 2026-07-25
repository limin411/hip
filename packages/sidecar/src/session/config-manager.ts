import type { SessionConfig, SkillMeta, AgentConfig, McpServerConfig } from '@hip/protocol'
import { loadExtensions } from './extensions/load.js'
import { HookRegistry } from './hooks/registry.js'

export class ConfigManager {
  private cachedSkills: SkillMeta[] | null = null
  private cachedMcpConfigs: McpServerConfig[] | null = null
  private cachedPluginAgents: AgentConfig[] | null = null
  /** Last extension conflicts from ExtensionRegistry (for inspect / future UI). */
  private cachedConflicts: import('@hip/protocol').ExtensionConflict[] = []

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
  get extensionConflicts(): import('@hip/protocol').ExtensionConflict[] {
    return this.cachedConflicts
  }

  /** Load (or reload) per-session plugin components via ExtensionRegistry SSOT. */
  loadPluginComponents(): void {
    if (this.isExternalAgent()) {
      this.cachedSkills = []
      this.cachedMcpConfigs = []
      this.cachedPluginAgents = []
      this.cachedConflicts = []
      return
    }
    this.hookRegistry.clear()
    const cwd = this.getConfig().cwd ?? process.cwd()
    try {
      const loaded = loadExtensions(cwd)
      this.cachedSkills = loaded.skills
      this.cachedMcpConfigs = loaded.mcpConfigs
      this.cachedPluginAgents = loaded.pluginAgents
      this.cachedConflicts = loaded.conflicts
      for (const entry of loaded.pluginHooks) {
        for (const hook of entry.hooks) {
          this.hookRegistry.register(hook)
        }
      }
      // Log only high-signal conflicts (not routine project/user overrides of builtin).
      const notable = loaded.conflicts.filter(
        (c) =>
          c.kind === 'mcp_capability_duplicate' ||
          c.kind === 'mcp_name_veto' ||
          c.kind === 'mcp_id_shadow' ||
          (c.kind === 'skill_id_shadow' &&
            (c.loser.kind === 'plugin_skill' || c.winner.kind === 'plugin_skill')),
      )
      if (notable.length > 0) {
        console.warn(
          `[extensions] ${notable.length} notable conflict(s) (MCP id/capability or plugin skill shadow)`,
        )
      }
    } catch (e) {
      console.warn(
        '[extensions] load failed; skills/MCP empty for this session:',
        e instanceof Error ? e.message : e,
      )
      this.cachedSkills = []
      this.cachedMcpConfigs = []
      this.cachedPluginAgents = []
      this.cachedConflicts = []
    }
  }

  /** Reload plugin components after config changes. */
  reloadPlugins(): void {
    this.cachedSkills = null
    this.cachedMcpConfigs = null
    this.cachedPluginAgents = null
    this.cachedConflicts = []
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

  /**
   * Force plan mode for subsequent turns.
   * Enabling (true) is NO-OP while a turn is running.
   * Clearing (false) is always allowed — plan-ready / approve must drop the gate mid-turn.
   */
  setForcePlan(forcePlan: boolean): boolean {
    if (forcePlan && this.isRunning()) return false
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
