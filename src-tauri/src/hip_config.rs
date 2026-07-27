//! HipConfig / TOML mirror types and serde conversions for ~/.hip/config/hip.toml.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Unified TOML config types (wave 1) ──

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct BoundModel {
    // Protocol (packages/protocol) uses capital-ID keys, not plain camelCase.
    #[serde(rename = "providerID")]
    pub(crate) provider_id: String,
    #[serde(rename = "modelID")]
    pub(crate) model_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct ActiveModel {
    // Protocol (packages/protocol) uses capital-ID/URL keys, not plain camelCase.
    #[serde(rename = "providerID")]
    pub(crate) provider_id: String,
    #[serde(rename = "modelID")]
    pub(crate) model_id: String,
    #[serde(rename = "baseURL")]
    pub(crate) base_url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderEntry {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) base_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) api_key: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpServerEntry {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) transport: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) command: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) headers: Option<HashMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) enabled_tools: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) disabled_tools: Option<Vec<String>>,
    pub(crate) enabled: bool,
    /// MCP Registry reverse-DNS name when installed from a market source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) registry_name: Option<String>,
    /// Market source id (e.g. `mcp-official`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) registry_source_id: Option<String>,
    /// Registry version at install time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) registry_version: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentEntry {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) description: Option<String>,
    pub(crate) kind: String,
    pub(crate) command: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) bound_model: Option<BoundModel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) quirks: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) allowed_tools: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) allowed_skills: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) allowed_mcp_servers: Option<Vec<String>>,
    pub(crate) enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillEntry {
    pub(crate) id: String,
    pub(crate) enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolPermissionConfig {
    pub(crate) default_mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) overrides: Option<HashMap<String, String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PermissionEntry {
    pub(crate) coarse_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) tool_permissions: Option<ToolPermissionConfig>,
}

/// Optional `[agentLoop]` section (Track A-config). JSON uses camelCase for the UI.
/// Must preserve all sidecar-recognized fields so set_hip_config rewrites do not strip them.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentLoopConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) max_steps: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) child_max_steps: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) explore_child_max_steps: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) max_depth: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) subagent_hitl: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) doom_loop_strategy: Option<String>,
}

/// Optional `[terminal]` section. JSON uses camelCase for the UI.
/// Must be preserved on set_hip_config rewrites so shell / colorTheme are not stripped.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalConfig {
    /// Preferred interactive shell: default | cmd | powershell | pwsh | bash | zsh
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) shell: Option<String>,
    /// xterm color palette id (follow | light | dark | named presets). JSON key: colorTheme.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) color_theme: Option<String>,
}

/// Optional `[window]` section. JSON uses camelCase for the UI.
/// Must be preserved on set_hip_config rewrites so close/tray policy is not stripped.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WindowConfig {
    /// hide | quit | ask
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) close_action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) tray_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) tray_always_visible: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) close_prompt_seen: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) hide_hint_shown: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) launch_at_login: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) start_hidden_on_login: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) notify_on_agent_complete: Option<bool>,
}

/// Optional `[acp]` host policy. JSON uses camelCase for the UI.
/// Must be preserved on set_hip_config rewrites so MCP forward / FS bridge flags are not stripped.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AcpHostConfig {
    /// Advertise + implement fs/read_text_file & fs/write_text_file. Default true when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) fs_bridge: Option<bool>,
    /// Forward enabled hip + plugin MCP configs into ACP session/new|load. Default false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) forward_mcp: Option<bool>,
    /// Max bytes for one fs/read_text_file. Default 2_000_000 when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) fs_read_max_bytes: Option<u64>,
}

/// Optional `[plan]` product knobs (PR-6 / KD-8). JSON uses camelCase for the UI.
/// Must be preserved on set_hip_config rewrites so soft-approve flag is not stripped.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanConfig {
    /// When true, composer submit during plan approval soft-approves via message:resume.
    /// Default false (composer / service path amends via plan:respond).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) soft_approve_on_composer: Option<bool>,
}

/// Optional `[voice]` local dictation (whisper.cpp). JSON uses camelCase for the UI.
/// Must be preserved on set_hip_config rewrites so device / model prefs are not stripped.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) input_device_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) input_device_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) input_device_group_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) max_duration_sec: Option<u32>,
    /// Per-model download URL overrides (`[voice.model_urls]` / modelUrls).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) model_urls: Option<HashMap<String, String>>,
}

/// Optional `[proxy]` HTTP(S) proxy. JSON uses camelCase for the UI.
/// Must be preserved on set_hip_config rewrites.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProxyConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) http: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) https: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) all: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) no_proxy: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HipConfig {
    pub(crate) version: u32,
    #[serde(default)]
    pub(crate) providers: Vec<ProviderEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) active_model: Option<ActiveModel>,
    #[serde(default)]
    pub(crate) mcp_servers: Vec<McpServerEntry>,
    #[serde(default)]
    pub(crate) skills: Vec<SkillEntry>,
    #[serde(default)]
    pub(crate) agents: Vec<AgentEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) fixed_agents: Option<HashMap<String, bool>>,
    #[serde(default)]
    pub(crate) permissions: Option<PermissionEntry>,
    /// Optional agent-loop controls (doom strategy, etc.). Preserved on set_hip_config rewrites.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) agent_loop: Option<AgentLoopConfig>,
    /// Optional Terminal defaults. Preserved on set_hip_config rewrites.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) terminal: Option<TerminalConfig>,
    /// Optional window close / tray policy. Preserved on set_hip_config rewrites.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) window: Option<WindowConfig>,
    /// Optional ACP host policy. Preserved on set_hip_config rewrites.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) acp: Option<AcpHostConfig>,
    /// Optional plan-mode product knobs. Preserved on set_hip_config rewrites.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) plan: Option<PlanConfig>,
    /// Optional local voice dictation. Preserved on set_hip_config rewrites.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) voice: Option<VoiceConfig>,
    /// Optional HTTP(S) proxy. Preserved on set_hip_config rewrites.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) proxy: Option<ProxyConfig>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkPolicyConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) allowlist: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) denylist: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) max_requests_per_minute: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) max_response_bytes: Option<u64>,
}

// ── TOML mirror structs (snake_case with camelCase aliases for backward compat) ──

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) struct TomlBoundModel {
    #[serde(alias = "providerId")]
    pub(crate) provider_id: String,
    #[serde(alias = "modelId")]
    pub(crate) model_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) struct TomlActiveModel {
    #[serde(alias = "providerId")]
    pub(crate) provider_id: String,
    #[serde(alias = "modelId")]
    pub(crate) model_id: String,
    #[serde(alias = "baseUrl")]
    pub(crate) base_url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) struct TomlProviderEntry {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(alias = "baseUrl")]
    pub(crate) base_url: String,
    #[serde(skip_serializing_if = "Option::is_none", alias = "apiKey")]
    pub(crate) api_key: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) struct TomlMcpServerEntry {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) transport: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) command: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) headers: Option<HashMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "enabledTools")]
    pub(crate) enabled_tools: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "disabledTools")]
    pub(crate) disabled_tools: Option<Vec<String>>,
    pub(crate) enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "registryName")]
    pub(crate) registry_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "registrySourceId")]
    pub(crate) registry_source_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "registryVersion")]
    pub(crate) registry_version: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) struct TomlAgentEntry {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) description: Option<String>,
    pub(crate) kind: String,
    pub(crate) command: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "boundModel")]
    pub(crate) bound_model: Option<TomlBoundModel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) quirks: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "allowedTools")]
    pub(crate) allowed_tools: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "allowedSkills")]
    pub(crate) allowed_skills: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "allowedMcpServers")]
    pub(crate) allowed_mcp_servers: Option<Vec<String>>,
    pub(crate) enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) struct TomlSkillEntry {
    pub(crate) id: String,
    pub(crate) enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) struct TomlToolPermissionConfig {
    #[serde(alias = "defaultMode")]
    pub(crate) default_mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) overrides: Option<HashMap<String, String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) struct TomlPermissionEntry {
    #[serde(alias = "coarseMode")]
    pub(crate) coarse_mode: String,
    #[serde(skip_serializing_if = "Option::is_none", alias = "toolPermissions")]
    pub(crate) tool_permissions: Option<TomlToolPermissionConfig>,
}

/// TOML mirror for `[agent_loop]` / `[agentLoop]`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) struct TomlAgentLoopConfig {
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "maxSteps")]
    pub(crate) max_steps: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "childMaxSteps")]
    pub(crate) child_max_steps: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "exploreChildMaxSteps")]
    pub(crate) explore_child_max_steps: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "maxDepth")]
    pub(crate) max_depth: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "subagentHitl")]
    pub(crate) subagent_hitl: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "doomLoopStrategy")]
    pub(crate) doom_loop_strategy: Option<String>,
}

/// TOML mirror for `[terminal]` (snake_case keys; camelCase aliases for hand-edited files).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) struct TomlTerminalConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) shell: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "colorTheme")]
    pub(crate) color_theme: Option<String>,
}

/// TOML mirror for `[window]` (snake_case keys; camelCase aliases for hand-edited files).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) struct TomlWindowConfig {
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "closeAction")]
    pub(crate) close_action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "trayEnabled")]
    pub(crate) tray_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "trayAlwaysVisible")]
    pub(crate) tray_always_visible: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "closePromptSeen")]
    pub(crate) close_prompt_seen: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "hideHintShown")]
    pub(crate) hide_hint_shown: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "launchAtLogin")]
    pub(crate) launch_at_login: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "startHiddenOnLogin")]
    pub(crate) start_hidden_on_login: Option<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "notifyOnAgentComplete"
    )]
    pub(crate) notify_on_agent_complete: Option<bool>,
}

/// TOML mirror for `[acp]` (snake_case keys; camelCase aliases for hand-edited files).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) struct TomlAcpHostConfig {
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "fsBridge")]
    pub(crate) fs_bridge: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "forwardMcp")]
    pub(crate) forward_mcp: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "fsReadMaxBytes")]
    pub(crate) fs_read_max_bytes: Option<u64>,
}

/// TOML mirror for `[plan]` (snake_case keys; camelCase aliases for hand-edited files).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) struct TomlPlanConfig {
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "softApproveOnComposer")]
    pub(crate) soft_approve_on_composer: Option<bool>,
}

/// TOML mirror for `[voice]` (snake_case keys; camelCase aliases for hand-edited files).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) struct TomlVoiceConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "inputDeviceId")]
    pub(crate) input_device_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "inputDeviceLabel")]
    pub(crate) input_device_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "inputDeviceGroupId")]
    pub(crate) input_device_group_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "maxDurationSec")]
    pub(crate) max_duration_sec: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "modelUrls")]
    pub(crate) model_urls: Option<HashMap<String, String>>,
}

/// TOML mirror for `[proxy]` (snake_case keys; camelCase aliases for hand-edited files).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) struct TomlProxyConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) http: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) https: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) all: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "noProxy")]
    pub(crate) no_proxy: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub(crate) struct TomlHipConfig {
    pub(crate) version: u32,
    #[serde(default)]
    pub(crate) providers: Vec<TomlProviderEntry>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "activeModel")]
    pub(crate) active_model: Option<TomlActiveModel>,
    #[serde(default, alias = "mcpServers")]
    pub(crate) mcp_servers: Vec<TomlMcpServerEntry>,
    #[serde(default)]
    pub(crate) skills: Vec<TomlSkillEntry>,
    #[serde(default)]
    pub(crate) agents: Vec<TomlAgentEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "fixedAgents")]
    pub(crate) fixed_agents: Option<HashMap<String, bool>>,
    #[serde(default)]
    pub(crate) permissions: Option<TomlPermissionEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "agentLoop")]
    pub(crate) agent_loop: Option<TomlAgentLoopConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) terminal: Option<TomlTerminalConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) window: Option<TomlWindowConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) acp: Option<TomlAcpHostConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) plan: Option<TomlPlanConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) voice: Option<TomlVoiceConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) proxy: Option<TomlProxyConfig>,
}

// ── From impls: HipConfig ↔ TomlHipConfig (recursive field mapping) ──

impl From<BoundModel> for TomlBoundModel {
    fn from(b: BoundModel) -> Self {
        TomlBoundModel {
            provider_id: b.provider_id,
            model_id: b.model_id,
        }
    }
}

impl From<TomlBoundModel> for BoundModel {
    fn from(b: TomlBoundModel) -> Self {
        BoundModel {
            provider_id: b.provider_id,
            model_id: b.model_id,
        }
    }
}

impl From<ActiveModel> for TomlActiveModel {
    fn from(m: ActiveModel) -> Self {
        TomlActiveModel {
            provider_id: m.provider_id,
            model_id: m.model_id,
            base_url: m.base_url,
        }
    }
}

impl From<TomlActiveModel> for ActiveModel {
    fn from(m: TomlActiveModel) -> Self {
        ActiveModel {
            provider_id: m.provider_id,
            model_id: m.model_id,
            base_url: m.base_url,
        }
    }
}

impl From<ProviderEntry> for TomlProviderEntry {
    fn from(p: ProviderEntry) -> Self {
        TomlProviderEntry {
            id: p.id,
            name: p.name,
            base_url: p.base_url,
            api_key: p.api_key,
            enabled: p.enabled,
        }
    }
}

impl From<TomlProviderEntry> for ProviderEntry {
    fn from(p: TomlProviderEntry) -> Self {
        ProviderEntry {
            id: p.id,
            name: p.name,
            base_url: p.base_url,
            api_key: p.api_key,
            enabled: p.enabled,
        }
    }
}

impl From<McpServerEntry> for TomlMcpServerEntry {
    fn from(s: McpServerEntry) -> Self {
        TomlMcpServerEntry {
            id: s.id,
            name: s.name,
            transport: s.transport,
            command: s.command,
            args: s.args,
            env: s.env,
            url: s.url,
            headers: s.headers,
            enabled_tools: s.enabled_tools,
            disabled_tools: s.disabled_tools,
            enabled: s.enabled,
            registry_name: s.registry_name,
            registry_source_id: s.registry_source_id,
            registry_version: s.registry_version,
        }
    }
}

impl From<TomlMcpServerEntry> for McpServerEntry {
    fn from(s: TomlMcpServerEntry) -> Self {
        McpServerEntry {
            id: s.id,
            name: s.name,
            transport: s.transport,
            command: s.command,
            args: s.args,
            env: s.env,
            url: s.url,
            headers: s.headers,
            enabled_tools: s.enabled_tools,
            disabled_tools: s.disabled_tools,
            enabled: s.enabled,
            registry_name: s.registry_name,
            registry_source_id: s.registry_source_id,
            registry_version: s.registry_version,
        }
    }
}

/// Load HipConfig from disk (empty default when missing). Used by marketplace/registry modules.
pub fn load_hip_config(app: &tauri::AppHandle) -> Result<HipConfig, String> {
    let path = crate::paths::hip_config_path(app).ok_or("no config dir")?;
    match std::fs::read_to_string(&path) {
        Ok(raw) => {
            let toml_cfg: TomlHipConfig =
                toml::from_str(&raw).map_err(|e| format!("TOML parse error: {e}"))?;
            Ok(toml_cfg.into())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HipConfig {
            version: 1,
            providers: vec![],
            active_model: None,
            mcp_servers: vec![],
            skills: vec![],
            agents: vec![],
            fixed_agents: None,
            permissions: None,
            agent_loop: None,
            terminal: None,
            window: None,
            acp: None,
            plan: None,
            voice: None,
            proxy: None,
        }),
        Err(e) => Err(e.to_string()),
    }
}

impl From<AgentEntry> for TomlAgentEntry {
    fn from(a: AgentEntry) -> Self {
        TomlAgentEntry {
            id: a.id,
            name: a.name,
            description: a.description,
            kind: a.kind,
            command: a.command,
            args: a.args,
            bound_model: a.bound_model.map(|x| x.into()),
            quirks: a.quirks,
            env: a.env,
            prompt: a.prompt,
            allowed_tools: a.allowed_tools,
            allowed_skills: a.allowed_skills,
            allowed_mcp_servers: a.allowed_mcp_servers,
            enabled: a.enabled,
        }
    }
}

impl From<TomlAgentEntry> for AgentEntry {
    fn from(a: TomlAgentEntry) -> Self {
        AgentEntry {
            id: a.id,
            name: a.name,
            description: a.description,
            kind: a.kind,
            command: a.command,
            args: a.args,
            bound_model: a.bound_model.map(|x| x.into()),
            quirks: a.quirks,
            env: a.env,
            prompt: a.prompt,
            allowed_tools: a.allowed_tools,
            allowed_skills: a.allowed_skills,
            allowed_mcp_servers: a.allowed_mcp_servers,
            enabled: a.enabled,
        }
    }
}

impl From<SkillEntry> for TomlSkillEntry {
    fn from(s: SkillEntry) -> Self {
        TomlSkillEntry {
            id: s.id,
            enabled: s.enabled,
        }
    }
}

impl From<TomlSkillEntry> for SkillEntry {
    fn from(s: TomlSkillEntry) -> Self {
        SkillEntry {
            id: s.id,
            enabled: s.enabled,
        }
    }
}

impl From<ToolPermissionConfig> for TomlToolPermissionConfig {
    fn from(t: ToolPermissionConfig) -> Self {
        TomlToolPermissionConfig {
            default_mode: t.default_mode,
            overrides: t.overrides,
        }
    }
}

impl From<TomlToolPermissionConfig> for ToolPermissionConfig {
    fn from(t: TomlToolPermissionConfig) -> Self {
        ToolPermissionConfig {
            default_mode: t.default_mode,
            overrides: t.overrides,
        }
    }
}

impl From<PermissionEntry> for TomlPermissionEntry {
    fn from(p: PermissionEntry) -> Self {
        TomlPermissionEntry {
            coarse_mode: p.coarse_mode,
            tool_permissions: p.tool_permissions.map(|x| x.into()),
        }
    }
}

impl From<TomlPermissionEntry> for PermissionEntry {
    fn from(p: TomlPermissionEntry) -> Self {
        PermissionEntry {
            coarse_mode: p.coarse_mode,
            tool_permissions: p.tool_permissions.map(|x| x.into()),
        }
    }
}

impl From<AgentLoopConfig> for TomlAgentLoopConfig {
    fn from(a: AgentLoopConfig) -> Self {
        TomlAgentLoopConfig {
            max_steps: a.max_steps,
            child_max_steps: a.child_max_steps,
            explore_child_max_steps: a.explore_child_max_steps,
            max_depth: a.max_depth,
            subagent_hitl: a.subagent_hitl,
            doom_loop_strategy: a.doom_loop_strategy,
        }
    }
}

impl From<TomlAgentLoopConfig> for AgentLoopConfig {
    fn from(a: TomlAgentLoopConfig) -> Self {
        AgentLoopConfig {
            max_steps: a.max_steps,
            child_max_steps: a.child_max_steps,
            explore_child_max_steps: a.explore_child_max_steps,
            max_depth: a.max_depth,
            subagent_hitl: a.subagent_hitl,
            doom_loop_strategy: a.doom_loop_strategy,
        }
    }
}

impl From<TerminalConfig> for TomlTerminalConfig {
    fn from(t: TerminalConfig) -> Self {
        TomlTerminalConfig {
            shell: t.shell,
            color_theme: t.color_theme,
        }
    }
}

impl From<TomlTerminalConfig> for TerminalConfig {
    fn from(t: TomlTerminalConfig) -> Self {
        TerminalConfig {
            shell: t.shell,
            color_theme: t.color_theme,
        }
    }
}

impl From<WindowConfig> for TomlWindowConfig {
    fn from(w: WindowConfig) -> Self {
        TomlWindowConfig {
            close_action: w.close_action,
            tray_enabled: w.tray_enabled,
            tray_always_visible: w.tray_always_visible,
            close_prompt_seen: w.close_prompt_seen,
            hide_hint_shown: w.hide_hint_shown,
            launch_at_login: w.launch_at_login,
            start_hidden_on_login: w.start_hidden_on_login,
            notify_on_agent_complete: w.notify_on_agent_complete,
        }
    }
}

impl From<TomlWindowConfig> for WindowConfig {
    fn from(w: TomlWindowConfig) -> Self {
        WindowConfig {
            close_action: w.close_action,
            tray_enabled: w.tray_enabled,
            tray_always_visible: w.tray_always_visible,
            close_prompt_seen: w.close_prompt_seen,
            hide_hint_shown: w.hide_hint_shown,
            launch_at_login: w.launch_at_login,
            start_hidden_on_login: w.start_hidden_on_login,
            notify_on_agent_complete: w.notify_on_agent_complete,
        }
    }
}

impl From<AcpHostConfig> for TomlAcpHostConfig {
    fn from(a: AcpHostConfig) -> Self {
        TomlAcpHostConfig {
            fs_bridge: a.fs_bridge,
            forward_mcp: a.forward_mcp,
            fs_read_max_bytes: a.fs_read_max_bytes,
        }
    }
}

impl From<TomlAcpHostConfig> for AcpHostConfig {
    fn from(a: TomlAcpHostConfig) -> Self {
        AcpHostConfig {
            fs_bridge: a.fs_bridge,
            forward_mcp: a.forward_mcp,
            fs_read_max_bytes: a.fs_read_max_bytes,
        }
    }
}

impl From<PlanConfig> for TomlPlanConfig {
    fn from(p: PlanConfig) -> Self {
        TomlPlanConfig {
            soft_approve_on_composer: p.soft_approve_on_composer,
        }
    }
}

impl From<TomlPlanConfig> for PlanConfig {
    fn from(p: TomlPlanConfig) -> Self {
        PlanConfig {
            soft_approve_on_composer: p.soft_approve_on_composer,
        }
    }
}

impl From<VoiceConfig> for TomlVoiceConfig {
    fn from(v: VoiceConfig) -> Self {
        TomlVoiceConfig {
            enabled: v.enabled,
            input_device_id: v.input_device_id,
            input_device_label: v.input_device_label,
            input_device_group_id: v.input_device_group_id,
            language: v.language,
            model: v.model,
            max_duration_sec: v.max_duration_sec,
            model_urls: v.model_urls,
        }
    }
}

impl From<TomlVoiceConfig> for VoiceConfig {
    fn from(v: TomlVoiceConfig) -> Self {
        VoiceConfig {
            enabled: v.enabled,
            input_device_id: v.input_device_id,
            input_device_label: v.input_device_label,
            input_device_group_id: v.input_device_group_id,
            language: v.language,
            model: v.model,
            max_duration_sec: v.max_duration_sec,
            model_urls: v.model_urls,
        }
    }
}

impl From<ProxyConfig> for TomlProxyConfig {
    fn from(p: ProxyConfig) -> Self {
        TomlProxyConfig {
            enabled: p.enabled,
            http: p.http,
            https: p.https,
            all: p.all,
            no_proxy: p.no_proxy,
        }
    }
}

impl From<TomlProxyConfig> for ProxyConfig {
    fn from(p: TomlProxyConfig) -> Self {
        ProxyConfig {
            enabled: p.enabled,
            http: p.http,
            https: p.https,
            all: p.all,
            no_proxy: p.no_proxy,
        }
    }
}

impl From<HipConfig> for TomlHipConfig {
    fn from(cfg: HipConfig) -> Self {
        TomlHipConfig {
            version: cfg.version,
            providers: cfg.providers.into_iter().map(|x| x.into()).collect(),
            active_model: cfg.active_model.map(|x| x.into()),
            mcp_servers: cfg.mcp_servers.into_iter().map(|x| x.into()).collect(),
            skills: cfg.skills.into_iter().map(|x| x.into()).collect(),
            agents: cfg.agents.into_iter().map(|x| x.into()).collect(),
            fixed_agents: cfg.fixed_agents,
            permissions: cfg.permissions.map(|x| x.into()),
            agent_loop: cfg.agent_loop.map(|x| x.into()),
            terminal: cfg.terminal.map(|x| x.into()),
            window: cfg.window.map(|x| x.into()),
            acp: cfg.acp.map(|x| x.into()),
            plan: cfg.plan.map(|x| x.into()),
            voice: cfg.voice.map(|x| x.into()),
            proxy: cfg.proxy.map(|x| x.into()),
        }
    }
}

impl From<TomlHipConfig> for HipConfig {
    fn from(cfg: TomlHipConfig) -> Self {
        HipConfig {
            version: cfg.version,
            providers: cfg.providers.into_iter().map(|x| x.into()).collect(),
            active_model: cfg.active_model.map(|x| x.into()),
            mcp_servers: cfg.mcp_servers.into_iter().map(|x| x.into()).collect(),
            skills: cfg.skills.into_iter().map(|x| x.into()).collect(),
            agents: cfg.agents.into_iter().map(|x| x.into()).collect(),
            fixed_agents: cfg.fixed_agents,
            permissions: cfg.permissions.map(|x| x.into()),
            agent_loop: cfg.agent_loop.map(|x| x.into()),
            terminal: cfg.terminal.map(|x| x.into()),
            window: cfg.window.map(|x| x.into()),
            acp: cfg.acp.map(|x| x.into()),
            plan: cfg.plan.map(|x| x.into()),
            voice: cfg.voice.map(|x| x.into()),
            proxy: cfg.proxy.map(|x| x.into()),
        }
    }
}

#[cfg(test)]
mod voice_preserve_tests {
    use super::*;

    #[test]
    fn voice_round_trips_toml_with_terminal_and_window() {
        let cfg = HipConfig {
            version: 1,
            providers: vec![],
            active_model: None,
            mcp_servers: vec![],
            skills: vec![],
            agents: vec![],
            fixed_agents: None,
            permissions: None,
            agent_loop: None,
            terminal: Some(TerminalConfig {
                shell: Some("zsh".into()),
                color_theme: Some("dracula".into()),
            }),
            window: Some(WindowConfig {
                close_action: Some("hide".into()),
                tray_enabled: Some(true),
                tray_always_visible: None,
                close_prompt_seen: None,
                hide_hint_shown: None,
                launch_at_login: None,
                start_hidden_on_login: None,
                notify_on_agent_complete: None,
            }),
            acp: None,
            plan: None,
            voice: Some(VoiceConfig {
                enabled: Some(true),
                input_device_id: Some("default".into()),
                input_device_label: Some("Mic".into()),
                input_device_group_id: Some("g1".into()),
                language: Some("auto".into()),
                model: Some("base".into()),
                max_duration_sec: Some(60),
                model_urls: None,
            }),
            proxy: None,
        };
        let toml_cfg: TomlHipConfig = cfg.clone().into();
        let text = toml::to_string_pretty(&toml_cfg).expect("serialize");
        assert!(text.contains("[voice]"), "{text}");
        assert!(text.contains("[terminal]"), "{text}");
        assert!(text.contains("[window]"), "{text}");
        let parsed: TomlHipConfig = toml::from_str(&text).expect("parse");
        let back: HipConfig = parsed.into();
        assert_eq!(back.voice, cfg.voice);
        assert_eq!(back.terminal, cfg.terminal);
        assert_eq!(back.window, cfg.window);
    }

    #[test]
    fn voice_accepts_camel_case_toml_aliases() {
        let text = r#"
version = 1
[voice]
enabled = true
inputDeviceId = "dev-1"
inputDeviceLabel = "USB Mic"
inputDeviceGroupId = "grp"
language = "zh"
model = "tiny"
maxDurationSec = 45
"#;
        let parsed: TomlHipConfig = toml::from_str(text).expect("parse");
        let cfg: HipConfig = parsed.into();
        let v = cfg.voice.expect("voice");
        assert_eq!(v.input_device_id.as_deref(), Some("dev-1"));
        assert_eq!(v.input_device_label.as_deref(), Some("USB Mic"));
        assert_eq!(v.max_duration_sec, Some(45));
        assert_eq!(v.model.as_deref(), Some("tiny"));
    }
}

