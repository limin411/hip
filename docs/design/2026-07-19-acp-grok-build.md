# ACP Grok Build Integration — hip 对接 Grok Build 智能体

| Field | Value |
|-------|-------|
| **Title** | 新增 ACP 智能体：Grok Build 完整对接 |
| **Author** | hip |
| **Date** | 2026-07-19 |
| **Status** | Implemented |
| **Primary scope** | Settings ACP picker + PATH + sidecar ACP session options / model mode |
| **Workspace** | hip |
| **Audience** | Product + frontend + sidecar |

---

## Overview

在 **设置 → 智能体 → 新增 ACP 智能体** 中增加 **Grok Build**（xAI coding agent）为一等公民 preset。Grok 原生支持 ACP（`grok agent stdio`），与 OpenCode 同类，无需社区 adapter。

本方案目标是 **完整可用**，不仅是 picker 多一张卡片：

1. PATH 检测能发现 `~/.grok/bin/grok`（GUI 启动也能看到）
2. 添加后 spawn `grok agent stdio`，走现有 warm ACP child 通路
3. 自管认证（`~/.grok/auth.json`）+ 可选 `XAI_API_KEY` 注入
4. 将会话返回的 `models` / reasoning effort 映射为 hip 的 model/mode 选择器
5. `session/set_config_option` 不可用时回退到 Grok 的 `session/set_model` / `session/set_mode`
6. 流式 message / thought / tool / plan / permission 与现有 UI 对齐

---

## Background

### hip ACP 现状

| Layer | Path |
|-------|------|
| Presets | `src/lib/acpPresets.ts` |
| Picker UI | `AcpProviderPicker` / `AgentEditor` |
| PATH | `src-tauri/src/path_env.rs` + `which_binaries` |
| Runtime | sidecar `AcpConnection` / `AcpAgentProvider` |
| Quirks | `acp-quirks.ts` |

Existing presets: OpenCode (native), Pi / Claude Code / Codex (bridged adapters).

### Grok Build facts (probed locally, CLI 0.2.x)

| Item | Value |
|------|-------|
| Install | `curl -fsSL https://x.ai/cli/install.sh \| bash` → `~/.grok/bin/grok` |
| ACP | `grok agent stdio` (protocolVersion 1) |
| Auth | `cached_token` (`~/.grok/auth.json`) + optional `XAI_API_KEY` |
| loadSession | true |
| session/new | returns `models{currentModelId,availableModels}` + effort meta; **not** standard `configOptions` |
| set model | `session/set_model` `{ sessionId, modelId }` (not `session/set_config_option`) |
| set effort | `session/set_mode` `{ sessionId, modeId }` (`high`/`medium`/`low`) |
| Cancel | hip already relies on local abort flag after `conn.cancel` |

---

## Design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Integration mode | Native ACP preset | Official path; no adapter |
| Launch | `grok` + `['agent','stdio']` | Documented; no `-m` (self-managed model) |
| No npx | Pre-installed binary only | Matches hip policy |
| authEnvVar | `XAI_API_KEY` optional | Blank ⇒ ambient session; filled ⇒ CI-friendly |
| PATH | Add `~/.grok/bin` to common_dirs | Required for Dock/GUI detection |
| Config options | Synthesize from `models` + efforts | Standard hip model/mode UI |
| setConfigOption | Fallback to set_model / set_mode | Grok lacks set_config_option |
| kind | Stay `acp` | No protocol kind expansion |
| yolo | Never default | Preserve hip HITL |

### Non-goals (v1)

- WebSocket `agent serve` / relay
- Embedding Grok OAuth in hip UI
- Forwarding Grok-only `x.ai/*` extension methods beyond set_model
- Changing hip’s internal LangGraph agents

---

## Architecture

```text
UI picker → AgentConfig { kind:acp, command:grok, args:[agent,stdio], quirks:grok-build, env? }
        → sidecar AcpAgentProvider
        → AcpConnection spawn(grok agent stdio)
        → initialize / authenticate(cached_token if needed)
        → session/new → extract models → agent:configOptions
        → prompt / updates / requestPermission
        → setConfigOption → set_config_option | set_model | set_mode
```

---

## PR plan (executed as one change set)

### PR-1 — PATH + preset + tests

- `path_env.rs`: Unix `~/.grok/bin`, Windows `%USERPROFILE%\.grok\bin`
- `ACP_PRESETS` + `acpPresets.test.ts`
- Icon `sparkles` for Grok Build
- Optional `authEnvVar: 'XAI_API_KEY'`
- Comment / i18n polish

### PR-2 — Sidecar session options + model/mode fallback

- Pure helper `extractAcpConfigOptions` / `patchConfigOptionValue`
- `AcpConnection.newSessionWithOptions` uses extractor
- `AcpConnection.setConfigOption` fallback
- Plan sessionUpdate → `planUpdated` when present
- Unit tests (fixture + pure helpers)

### Acceptance

1. Picker shows Grok Build; detects when `~/.grok/bin` is on PATH
2. Added agent config matches preset
3. Dogfood: stream reply, tools, permission, multi-turn
4. Model/effort selectors appear when agent advertises models
5. Unit tests green

---

## Risks

| Risk | Mitigation |
|------|------------|
| Missing PATH dir | common_dirs fix |
| Unauthenticated agent | existing authRequired path + optional API key |
| set_config_option missing | set_model / set_mode fallback |
| Cancel semantics | local abort flag (existing) |
| CLI drift | pin documented args; follow changelog |

---

## File touch list

```text
docs/design/2026-07-19-acp-grok-build.md
src/lib/acpPresets.ts
src/lib/acpPresets.test.ts
src/components/account/AcpProviderPicker.tsx
src-tauri/src/path_env.rs
packages/sidecar/src/session/agents/acp-session-options.ts  (new)
packages/sidecar/src/session/agents/acp-session-options.test.ts  (new)
packages/sidecar/src/session/agents/acp-connection.ts
packages/sidecar/src/session/agents/acp-provider.ts
packages/sidecar/src/session/agents/acp-config.ts
packages/sidecar/src/session/agents/acp-quirks.ts
packages/sidecar/src/session/agents/acp-quirks.test.ts
packages/sidecar/src/session/agents/acp-config.test.ts
packages/product-content/references/agents-and-plugins.md
```
