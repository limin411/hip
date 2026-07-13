/** Provider and agent configuration types (including fixed built-in agents). */
/** Global current model the whole app uses. */
export interface ActiveModel {
  providerID: string
  modelID: string
  baseURL: string              // always resolved; sidecar falls back to DEEPSEEK_DEFAULT when unknown
}

/** One provider's non-secret config (the key lives only in ~/.hip/config/auth.json).
 *  This is the UI/runtime shape keyed by provider id; the durable source of truth is
 *  HipConfig.providers (ProviderEntry[]) in ~/.hip/config/hip.toml. */
export interface ProviderConfigEntry {
  enabled: boolean
  baseURL?: string             // catalog default or user override; required for custom
  custom?: { name: string }    // present iff user-defined (not in the models.dev catalog)
}

/** UI/runtime aggregate of provider config. The durable source of truth is
 *  HipConfig.providers / HipConfig.activeModel in ~/.hip/config/hip.toml. */
export interface ProvidersConfig {
  providers: Record<string, ProviderConfigEntry>
  activeModel?: Pick<ActiveModel, 'providerID' | 'modelID'>   // baseURL resolved at read time
}

/** Which configured model an external agent should use. */
export interface BoundModel { providerID: string; modelID: string }

export interface AgentConfig {
  id: string                          // nanoid
  name: string                        // display name
  description?: string                // when-to-use text shown to hip's dispatch tool + the agent card
  kind: 'custom' | 'opencode' | 'acp' | 'internal' // selects the provider/runtime
  command: string                     // executable (PATH name or absolute path); '' for internal
  args: string[]                      // static launch args; [] for internal
  boundModel?: BoundModel             // internal agents only: the agent's model (unset ⇒ global active); ignored for acp/custom
  quirks?: string                     // acp only: per-agent quirk-profile key (e.g. 'opencode')
  env?: Record<string, string>        // advanced manual env overrides
  prompt?: string                     // internal only: the persona system prompt (required for kind 'internal')
  /**
   * @deprecated No longer used to gate internal built-in tools (built-ins incl. run_script + use_skill
   * are always available to internal agents). Retained for back-compat with old hip-agents.json configs
   * AND as a one-time migration source: legacy `mcp__<id>__*` wildcards seed `allowedMcpServers` when that
   * field is undefined. New configs should set allowedSkills/allowedMcpServers instead.
   */
  allowedTools?: string[]
  /** internal only: Skill ids this agent may use (use_skill is restricted to these, and only these are
   *  advertised in its prompt). undefined/[] ⇒ none. */
  allowedSkills?: string[]
  /** internal only: MCP server ids whose tools this agent may use. undefined/[] ⇒ none. */
  allowedMcpServers?: string[]
  enabled: boolean
}

export interface AgentsConfig { agents: AgentConfig[] }

/**
 * IDs of the fixed (non-deletable) built-in agents whose enable/disable state is
 * persisted under `fixedAgents` in HipConfig. Kept here as a single source of truth
 * so the renderer and the sidecar agree on which agents are fixed.
 */
export const FIXED_AGENT_IDS = ['coder', 'explore', 'plan'] as const

/**
 * Three fixed, non-deletable internal agents.
 *
 * These are NOT stored in hip.toml's `agents` array. Their enable/disable
 * state is persisted under `[fixedAgents]` in hip.toml.
 */
export const FIXED_AGENTS: AgentConfig[] = [
  {
    id: 'coder',
    name: 'Coder',
    description:
      '默认子 Agent，通用软件工程助手，可读写文件、执行命令、搜索代码并落地具体改动。',
    kind: 'internal',
    command: '',
    args: [],
    enabled: true,
    prompt: `You are a software engineering assistant. You can read and write files, execute shell commands, search code, and implement concrete changes. When given a task, break it down into steps and execute them methodically. Always verify your changes work correctly.`,
  },
  {
    id: 'explore',
    name: 'Explore',
    description:
      '代码库探索专用，只读操作，不修改文件...',
    kind: 'internal',
    command: '',
    args: [],
    enabled: true,
    prompt: `You are a codebase exploration agent. You can read files, search code, and summarize findings — but you CANNOT modify any files, execute shell commands, or make any changes to the codebase. Your purpose is to understand, search, and report. When asked about the codebase, be thorough in your exploration before answering. Always finish with a clear plain-text summary of findings (paths, symbols, conclusions). Never emit DSML, XML tool markup, or raw function-call tags in your final answer.`,
  },
  {
    id: 'plan',
    name: 'Plan',
    description:
      '实现规划与架构设计专用...',
    kind: 'internal',
    command: '',
    args: [],
    enabled: true,
    prompt: `You are a software architecture and planning agent. You focus on analyzing requirements, designing implementation approaches, and creating detailed plans. You do NOT have access to shell commands — your job is to think through the problem and produce a clear, actionable plan that others can execute. Consider trade-offs, edge cases, and existing codebase patterns in your analysis.`,
  },
]
