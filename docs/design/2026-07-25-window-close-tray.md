# 关闭行为与系统托盘（Close Behavior & System Tray）

| Field | Value |
|-------|--------|
| **Title** | Window Close Behavior & System Tray |
| **Author** | TBD |
| **Date** | 2026-07-25 |
| **Status** | Phase 1 **implemented** (2026-07-25); Phase 2–3 still planned |
| **Audience** | hip core (React UI / Tauri shell / protocol config / CLI attach) |
| **Related** | `src-tauri/src/lib.rs` (`CloseRequested` → `exit(0)`); `GeneralSettings`; CLI attach-only; `HipConfig` / `hip.toml` |
| **Platforms** | macOS · Windows · Linux (best-effort tray) |

---

## Overview

hip 是常驻型 **AI workbench**：sidecar 跑 agent、PTY/SSH 可能长时存活、产品 CLI（`@hip/cli`）**attach-only** 依赖桌面进程在线。

当前 **关闭主窗口 = 立即退出**（杀掉 sidecar / PTY / SSH），用户误点红叉或 X 会中断全部后台工作。

本 spec 分三期交付：

| Phase | 一句话 | 用户可感知结果 |
|-------|--------|----------------|
| **P1** | 关窗策略 + 托盘恢复/退出 + 单实例 | 可隐藏到托盘；二次启动唤起；退出路径统一干净 |
| **P2** | 首次询问 + 有活任务时退出确认 + 托盘状态 | 不误杀任务；托盘能看出「还在干活」 |
| **P3** | 通知 / 开机自启 / 托盘快捷操作 | 常驻工作台体验完整 |

---

## Background & Motivation

### 现状（as-of 2026-07-25）

| 能力 | 现状 | 代码锚点 |
|------|------|----------|
| 关窗 | `WindowEvent::CloseRequested` → `app_handle.exit(0)` | `src-tauri/src/lib.rs` ~868–876 |
| 退出清理 | `ExitRequested`：kill sidecar、删 discovery 文件、kill_all PTY/SSH | 同文件 ~856–867 |
| 系统托盘 | **无** | — |
| 单实例 | **无**（二次启动可能再起 sidecar） | — |
| 通用设置 | 语言 / 主题 / 密度 / 终端 / 回收站 | `GeneralSettings.tsx` |
| 配置持久化 | `~/.hip/config/hip.toml` via `HipConfig` | `packages/protocol/src/hip-config.ts` |
| CLI | attach 运行中桌面 app；app 死则 CLI 失败 | README CLI 节 |

### 痛点

1. 关窗误杀长任务（agent / `task_batch` / PTY / SSH）。
2. CLI 依赖存活 host，关窗 = 断 CLI。
3. 无托盘时用户无法「藏窗继续跑」。
4. 对标 Claude Desktop 等：静默驻后台且无退出开关会引发投诉；必须 **可配置 + 真退出**。

### Prior art（外部实践蒸馏）

| 模式 | 产品 | 对本方案 |
|------|------|----------|
| 关窗 → 托盘；托盘退出 | 微信 / QQ / Discord | P1 核心 |
| 首次关窗三选一 + 记住 | 微信等 | P2 默认引导 |
| 关窗策略设置项 | Claude Desktop（社区强需求） | P1 设置 |
| 托盘状态 / 通知 | Slack / 邮件客户端 | P2–P3 |
| macOS 红灯 ≠ Quit；Cmd+Q = Quit | 系统惯例 | P1 平台规则 |
| 无 tray 时 fallback 退出 | Claude Desktop Linux 缺陷反例 | P1 必须 |

---

## Goals & Non-Goals

### Goals

1. 用户可配置：**关闭主窗口**时 **隐藏到托盘** 或 **退出应用**。
2. 托盘提供 **显示主界面** 与 **退出**；左键单击显示/置前主窗口。
3. **隐藏 ≠ 退出**：隐藏时 sidecar / agent / PTY / SSH / CLI attach **继续存活**。
4. **退出路径唯一**：托盘退出、菜单退出、Cmd+Q、设置「直接关闭」后的关窗，均走同一 `ExitRequested` 清理。
5. **单实例**：二次启动唤起已有窗口，不复制 sidecar。
6. 分 Phase 交付；每期独立可发布、可回滚。

### Non-Goals（全 Phase 共同）

- 多主窗口 / 每窗口独立关闭策略。
- 托盘内嵌完整 Chat UI。
- 隐藏时自动挂起 agent 省电（语义与「后台继续跑」冲突；另案讨论）。
- 改 keychain / auth 存储方式。
- Linux 上保证所有桌面环境都有 tray（无 tray 则 fallback）。

---

## Glossary

| 术语 | 定义 |
|------|------|
| **Hide** | 隐藏主窗口；进程与 sidecar 继续；托盘可见（若启用） |
| **Quit / Exit** | 完整退出：`ExitRequested` 清理后进程结束 |
| **Close button** | 窗口装饰关闭（macOS 红灯 / Windows·Linux X） |
| **Tray** | 系统托盘 / 菜单栏图标（macOS menu bar；Windows notification area） |
| **Show** | 显示主窗口 + unminimize + focus/置前 |
| **Active work** | 存在 running agent turn、活跃 Runtime 任务、或产品定义的其它阻断退出条件（P2） |

---

## Config Model

新增可选节 **`[window]`**，写入 `~/.hip/config/hip.toml`，经 `HipConfig` 读写（与 `terminal` / `trash` 同模式）。

### Schema

```toml
# ~/.hip/config/hip.toml
[window]
# 关闭主窗口时的行为
# "hide"  — 隐藏到托盘（需 tray 可用）
# "quit"  — 退出应用
# "ask"   — 每次询问（P2；P1 可解析但 UI 可先映射为 hide 或仅设置项灰显）
closeAction = "hide"   # hide | quit | ask

# 是否创建系统托盘图标。false 时 closeAction 强制按 quit 处理（关窗=退出）
trayEnabled = true

# P1 可选：是否始终显示托盘；false = 仅在窗口隐藏后显示托盘
# 默认 true（可发现性优先）
trayAlwaysVisible = true

# 是否已完成「首次关窗」引导（P2 写入；缺省 false）
closePromptSeen = false

# P3
launchAtLogin = false
notifyOnAgentComplete = true
```

### TypeScript（`@hip/protocol`）

```ts
/** Optional `[window]` section in hip.toml — close behavior & tray. */
export type WindowCloseAction = 'hide' | 'quit' | 'ask'

export interface WindowConfig {
  /**
   * Behavior when the user closes the main window chrome.
   * Default (product): 'ask' after P2 lands; until then treat missing as 'quit'
   * to preserve historical behavior for existing installs, OR migrate once with
   * first-run prompt (see Defaults & Migration).
   */
  closeAction?: WindowCloseAction
  /** Create system tray icon. Default true when omitted (P1+). */
  trayEnabled?: boolean
  /**
   * If true, tray exists whenever trayEnabled.
   * If false, tray is created only while main window is hidden (P1 optional; default true).
   */
  trayAlwaysVisible?: boolean
  /** User completed first-close dialog (P2). Default false. */
  closePromptSeen?: boolean
  /** Launch hip at OS login (P3). Default false. */
  launchAtLogin?: boolean
  /** OS notification when an agent turn finishes while hidden (P3). Default true. */
  notifyOnAgentComplete?: boolean
}

// HipConfig adds:
// window?: WindowConfig
```

### TOML 键名

- 权威：camelCase in TS / JSON round-trip。
- TOML 解析：接受 `close_action` / `closeAction` 等同既有 `color_theme` 风格（sidecar / Rust 读配置侧需对齐现有 normalize 规则）。

### Defaults & Migration

| 场景 | 行为 |
|------|------|
| 无 `[window]` 节（老用户） | **P1 发布瞬间**：行为可保持 `quit`（零惊讶）**或** 首次关窗触发 P2 询问；**推荐**：P1 默认 `quit` + 设置可改；P2 对 `closePromptSeen=false` 的用户在**第一次关窗**强制询问并写入偏好 |
| 新安装（P2 后） | 第一次关窗 → `ask` 流；记住后写入 `closeAction` + `closePromptSeen=true` |
| `trayEnabled=false` | 关窗一律 `quit`；设置 UI 中 closeAction 锁定/提示 |
| Tray 创建失败（Linux 等） | 运行时等效 `trayEnabled=false` 一次会话；toast 或日志说明；关窗 fallback `quit` |

**P1 明确产品默认（写进设置描述）：**

- `closeAction` 缺省解析为 **`quit`**（兼容现状）。
- 设置 UI 展示推荐文案：对 AI workbench **推荐选择「隐藏到托盘」**。
- 不在 P1 自动改写老用户配置。

---

## Architecture

### 进程与责任

```text
┌─────────────────────────────────────────────────────────────┐
│ Tauri Shell (Rust)                                          │
│  · TrayIcon + Menu                                          │
│  · CloseRequested 拦截（prevent_close + hide / exit）       │
│  · Single-instance（二次启动 → show 已有窗）                │
│  · ExitRequested 既有清理（sidecar / PTY / SSH / discovery） │
│  · 读 window 配置（启动时 + 变更命令）                      │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC commands / events
┌──────────────────────────▼──────────────────────────────────┐
│ React UI                                                    │
│  · GeneralSettings「窗口与后台」                            │
│  · P2 首次关窗对话框 / 退出确认对话框                       │
│  · 汇总 active work → 推送给 Rust 或响应 confirm 请求       │
└──────────────────────────┬──────────────────────────────────┘
                           │ WS
┌──────────────────────────▼──────────────────────────────────┐
│ Sidecar                                                     │
│  · 隐藏期间不特殊处理；退出时随 host kill                   │
│  · CLI attach 仍依赖 host 存活                              │
└─────────────────────────────────────────────────────────────┘
```

### 关窗决策（概念）

```text
CloseRequested
  │
  ├─ api_quit_flag / force_quit?  → prevent_close=false path → Exit
  │
  ├─ tray unavailable OR trayEnabled=false → Exit
  │
  ├─ closeAction == quit → Exit
  │
  ├─ closeAction == hide → prevent_close; hide window; ensure tray
  │
  └─ closeAction == ask (P2)
        → prevent_close; emit "window://close-prompt" to FE
        → FE dialog → user picks hide|quit (+ remember)
        → FE calls window_apply_close_decision
```

**关键约束：** 决策必须在 **Rust 侧可最终执行** hide/exit；FE 对话框只影响 `ask` 与 P2 确认，不能成为唯一持有配置的地方（配置以 hip.toml 为准）。

### 退出路径统一

| 入口 | 行为 |
|------|------|
| 托盘「退出」 | `AppHandle::exit(0)` → `ExitRequested` |
| 应用菜单 Quit / Cmd+Q | 同上（**不受** closeAction=hide 影响） |
| 关窗 + closeAction=quit | 同上 |
| 关窗 + hide | **不** exit |
| OS 强制杀进程 | 无 handler（既有 HIP_PARENT_WATCH 清理 sidecar） |

### 显示主窗口（Show）

统一函数 `show_main_window(app)`：

1. 取 label 主窗口（tauri.conf 默认唯一 window）。
2. `show()` + `unminimize()` + `set_focus()`。
3. macOS：必要时 `NSApp activate`（若 API 可用）。
4. 若 `trayAlwaysVisible=false`，Show 后可销毁或隐藏托盘图标（P1 若实现该开关）。

---

## Phase 1 — 可用且不坑用户

**目标：** 设置可配；托盘可恢复/退出；隐藏保活；单实例；无 tray fallback。

### P1 Scope

| # | 项 | 必做 |
|---|-----|------|
| 1.1 | `[window]` 配置读写 + protocol 类型 | ✅ |
| 1.2 | 通用设置 UI：关闭窗口时 / 启用托盘 | ✅ |
| 1.3 | Tray：图标 + 左键 Show + 右键「显示主界面」「退出」 | ✅ |
| 1.4 | `CloseRequested`：hide vs quit | ✅ |
| 1.5 | 退出统一 `ExitRequested` 清理（不回归） | ✅ |
| 1.6 | 单实例：二次启动 Show 已有窗 | ✅ |
| 1.7 | Tray 创建失败 → 当次会话 fallback quit | ✅ |
| 1.8 | i18n（zh-CN / zh-TW / en / ja / ko） | ✅ |
| 1.9 | 单元测试（配置 normalize）+ 关键 e2e/hooks | ✅ |

### P1 Explicitly Out

- 首次关窗对话框（P2）
- 退出时 active work 确认（P2）
- 托盘 badge / tooltip 动态状态（P2）
- 系统通知、开机自启、托盘快捷会话（P3）
- `closeAction = "ask"` 完整 UI（P1 可在类型中预留；设置下拉仅 `hide` | `quit`）

### P1 UX 文案（中文示意）

**设置 → 通用 → 窗口与后台**

| UI | 文案 |
|----|------|
| 区块标题 | 窗口与后台 |
| 关闭窗口时 | 关闭窗口时 |
| 选项 hide | 隐藏到系统托盘 |
| 选项 quit | 退出 hip |
| 描述 | 隐藏后 agent、终端与 sidecar 继续运行。真正退出请使用托盘菜单或「退出 hip」。 |
| 启用托盘 | 启用系统托盘图标 |
| 托盘描述 | 关闭后可通过托盘恢复窗口。若关闭本选项，关闭窗口将始终退出。 |

**托盘菜单**

1. 显示主界面  
2. ───（分隔线可选）  
3. 退出  

**左键：** 显示主界面（若已显示则 focus；可选 toggle hide——**P1 定为仅 Show，不做 toggle hide**，避免误触藏窗）。

### P1 行为矩阵

| 条件 | 关窗 | 托盘 | Cmd+Q |
|------|------|------|-------|
| tray on + hide | Hide | 有 | Quit |
| tray on + quit | Quit | 有（P1 始终显示若 trayAlwaysVisible 默认 true） | Quit |
| tray off | Quit | 无 | Quit |
| tray 创建失败 | Quit | 无 | Quit |

### P1 技术要点

#### Rust

- Cargo：`tauri` feature **`tray-icon`**（及菜单 API 所需 feature）。
- 启动时：若 `trayEnabled`，`TrayIconBuilder` + `Menu`。
- macOS：`icon_as_template(true)` 使用可适配菜单栏的 template 图（需提供 template 资源或复用现有 icon 评估观感）。
- `CloseRequested { api, .. }`：调用 `api.prevent_close()` 后 `window.hide()`；或 `app.exit(0)`。
- 状态：`TrayState` / `WindowPolicy` 存于 `app.manage`；设置变更经 command `window_set_policy` 热更新。

#### 配置读取路径

两种实现选一（spec 锁定推荐）：

**推荐 A（与 terminal 一致）：** FE `hipConfigStore.updateSection('window', …)` → 既有 `set_hip_config` → 写 toml；Rust **另外**在启动读 toml 中的 `[window]`；热更新时 FE 调 `window_apply_policy` 把当前策略推给 Rust（避免 Rust 与 sidecar 争读）。

**备选 B：** Rust 只从 toml 读，配置变更后 FE invoke `window_reload_policy`。

P1 采用 **A**：策略以 FE 推送 + 启动时 Rust 读盘双源；冲突以 **最近一次成功写入 hip.toml 的值** 为准，启动以磁盘为准。

#### 单实例

- 使用 Tauri 2 官方或社区 **single-instance** 插件（`tauri-plugin-single-instance`）。
- 回调：已有实例 `show_main_window`。
- 开发模式（`tauri dev`）：**允许** 多实例以免挡调试（feature/`cfg(debug_assertions)` 关闭单实例，或 env `HIP_ALLOW_MULTI_INSTANCE=1`）。

#### CLI 兼容

- Hide 时 discovery 文件与 sidecar 端口保持 → CLI 继续 attach。
- Quit 时既有 `remove_discovery_file` 保持。
- 文档：README 增加一句「关闭到托盘时 CLI 仍可用；退出后 CLI 不可用」。

### P1 Acceptance Criteria

1. 设置选「隐藏到托盘」→ 关窗后进程仍在、sidecar 端口可达、主窗不可见、托盘可见。
2. 托盘「显示主界面」/ 左键 → 主窗恢复且可操作。
3. 托盘「退出」→ 进程结束、sidecar 死、无残留 hip 主进程（可接受短时清理）。
4. 设置选「退出」→ 关窗行为与今天一致。
5. 关托盘开关 → 关窗退出；托盘消失。
6. 二次启动（release 构建）→ 只保留一实例并 Show。
7. macOS Cmd+Q 始终退出，即使 closeAction=hide。
8. 通用设置 e2e smoke 仍通过；新增 i18n key 五语言齐全。

### P1 Test Plan

| 层 | 内容 |
|----|------|
| protocol | `WindowConfig` round-trip / unknown field ignore |
| Rust unit | policy resolve：tray off ⇒ quit；closeAction normalize |
| FE unit | GeneralSettings 选项渲染与 `updateSection` 调用 |
| 手工 / e2e | hide/show/quit；单实例（能自动化则加） |

### P1 Risks

| 风险 | 缓解 |
|------|------|
| macOS 隐藏后 Dock 点击不恢复 | 处理 Reopen / Dock 激活 → Show |
| 用户以为已退出仍占资源 | 设置描述 + P2 首次引导 |
| Linux 无 tray | fallback quit + 日志 |
| E2E 关窗路径变化 | E2E 使用「退出」策略或显式 quit API |

---

## Phase 2 — Workbench 感知

**目标：** 首次不迷惑；退出不误杀；托盘能表达「在干活」。

### P2 Scope

| # | 项 | 必做 |
|---|-----|------|
| 2.1 | `closeAction = "ask"` + 首次/每次询问对话框 | ✅ |
| 2.2 | `closePromptSeen` 记忆；「记住我的选择」 | ✅ |
| 2.3 | **真正退出**前 active work 确认 | ✅ |
| 2.4 | 托盘 tooltip + 简易运行中状态（图标或标题） | ✅ |
| 2.5 | 首次隐藏到托盘时一次性系统通知/气泡（Windows 尤重要） | ✅ 推荐 |
| 2.6 | i18n + 测试 | ✅ |

### P2 首次 / 询问对话框

**触发：** `closeAction == "ask"` **或**（`closePromptSeen == false` 且产品策略要求引导）。

**推荐产品策略：**

- P2 起：若 `closePromptSeen == false`，**无论**当前 `closeAction` 默认值，**第一次关窗**弹对话框（即使磁盘是 quit，也给一次「推荐隐藏」教育）。
- 用户勾选「记住」→ 写 `closeAction` + `closePromptSeen=true`。
- 不勾选「记住」→ 仅本次 hide/quit；`closePromptSeen` 仍可保持 false（每次问）**或** 记 seen 但不改 action——**锁定：不勾选记住 ⇒ 只应用本次，不写 closeAction，closePromptSeen 仍 false**。

**对话框文案（示意）：**

```
关闭窗口时：
  ○ 隐藏到系统托盘，后台继续运行 agent（推荐）
  ○ 退出 hip
  ☑ 记住我的选择
  [ 取消 ]  [ 确定 ]
```

取消 = 不关窗、不退出。

### P2 Active Work 退出确认

**仅对真正 Quit 路径**（关窗+quit、托盘退出、Cmd+Q）。

**Hide 不确认**（用户选 hide 就是为了不停任务）。

#### Active work 定义（P2）

满足任一则视为有 active work：

1. 任一 session `status === 'running'`（agent turn 进行中）。
2. `taskRuntimeStore`（或等价）存在 running 的 shell/monitor/agent 任务。
3. （可选，P2.1 可先不做）未保存 knowledge 草稿 —— **P2 MVP 可不含**，列在 Open Questions。

#### 确认 UI

```
仍有工作在进行：
  · 2 个会话中的 agent
  · 1 个后台终端任务

退出将中止这些工作。

[ 取消 ]  [ 隐藏到托盘 ]  [ 退出并中止 ]
```

- **取消**：中止退出。
- **隐藏到托盘**：改为 Hide（即使 closeAction=quit 的关窗路径，提供逃生；托盘退出场景下「隐藏」= 取消退出并保证窗隐）。
- **退出并中止**：继续 Quit。

#### 实现要点

- Cmd+Q / 托盘退出：Rust `ExitRequested` **之前**需 FE 确认 → 使用  
  `RunEvent::ExitRequested { api, .. }` + `api.prevent_exit()`，emit 事件给 FE，FE 确认后再 `app.exit(0)`。  
  **注意：** 与当前「ExitRequested 里立刻 kill sidecar」顺序协调：prevent 后不应杀；仅最终 exit 时杀。
- 需引入 **`force_quit` 标志**（用户已确认）避免确认循环。

### P2 托盘状态

| 状态 | Tooltip 示例 | 图标 |
|------|----------------|------|
| 空闲 | `hip` | 默认 |
| 运行中 | `hip · 2 agents running` | 可选叠加点 / 备用 icon |
| 错误（可选） | `hip · attention needed` | P2 可只做 running vs idle |

**数据流：** FE 聚合计数 → `invoke('tray_set_status', { runningAgents, runningTasks })` 节流（≥500ms）更新 tooltip。

P2 **不要求** 完整 badge 数字（Windows 托盘 badge 支持不一致）；tooltip 为 MVP。

### P2 首次 Hide 提示（Windows）

隐藏成功后若 `!hideHintShown`（可用另一 config 或 reuse prompt）：

- 系统 notification：`hip 仍在后台运行。单击托盘图标可恢复。`
- 写 `hideHintShown=true`（可挂在 `WindowConfig`）。

### P2 Acceptance Criteria

1. 新用户 / `closePromptSeen=false` 首次关窗必见对话框；记住后不再打扰。
2. 有 running agent 时托盘退出 / Cmd+Q 出现确认；取消则任务仍在跑。
3. 确认中选「隐藏到托盘」→ 不杀任务。
4. 运行中 tooltip 反映非零计数；空闲恢复默认。
5. 不破坏 P1 全部 AC。

---

## Phase 3 — 常驻增强

**目标：** 完整常驻工作台，不阻塞 P1/P2 价值。

### P3 Scope

| # | 项 | 优先级 |
|---|-----|--------|
| 3.1 | 开机自启 `launchAtLogin` | P0 in P3 |
| 3.2 | Agent 完成/失败系统通知（窗口隐藏时）`notifyOnAgentComplete` | P0 in P3 |
| 3.3 | 托盘菜单扩展 | P1 in P3 |
| 3.4 | `trayAlwaysVisible` 设置暴露（若 P1 已实现逻辑） | P1 in P3 |
| 3.5 | 托盘「中断当前 agent」 | P2 in P3 |
| 3.6 | 点击通知聚焦到对应 session | P1 in P3 |

### P3 托盘菜单（建议结构）

```
显示主界面
新建会话…          → emit FE / deep-link
最近项目 →          → 子菜单（最多 N 项，可选）
─────────
中断全部 agent…    → 需确认
打开设置
─────────
退出
```

P3 MVP 可只做：**显示主界面 · 打开设置 · 退出** + 通知；其余按工作量裁剪。

### P3 开机自启

- 设置项：`启动时运行 hip`（仅 `trayEnabled` 时有意义；可允许无托盘自启但少见）。
- 实现：`tauri-plugin-autostart`（或 OS 原生）。
- 自启后：默认 **不抢焦点**——启动到托盘（主窗 hide）若 `closeAction=hide` 或专用 `startMinimized`（可选字段，默认：autostart ⇒ start hidden）。

**建议新增：**

```toml
[window]
startHiddenOnLogin = true  # 仅 launchAtLogin 时生效；默认 true
```

### P3 通知

| 事件 | 条件 | 行为 |
|------|------|------|
| agent turn 成功结束 | 主窗 hidden 且 notify on | 系统通知；click → Show + focus session |
| agent 失败 / 需 HITL | 同上 | 通知；文案区分 |
| 主窗 focused | — | 不发完成通知（避免吵） |

权限：macOS 通知权限请求在第一次需要时触发。

### P3 Acceptance Criteria

1. 开机自启开关有效；登录后进程在、策略符合 startHidden。
2. 隐藏期间 agent 完成有通知；点击回到 UI。
3. 托盘「打开设置」打开设置页。
4. 关闭通知开关后不再发完成通知。

---

## Platform Matrix

| 行为 | macOS | Windows | Linux |
|------|-------|---------|-------|
| 关窗 hide | hide 窗；菜单栏 tray | hide 窗；notification area | 尽力；失败 fallback quit |
| Cmd+Q / Alt+F4 / 应用退出 | **始终 Quit 路径**（可走 P2 确认） | 同左 | 同左 |
| Dock / 任务栏二次点击 | Show | Show | Show |
| 单实例 | ✅ release | ✅ release | ✅ release |
| Template 图标 | ✅ | N/A | 视环境 |
| 通知 | UserNotifications | toast | 视桌面 |

### macOS 特别规则

1. **closeAction=hide** 对齐「红灯关窗不退出」心智。  
2. **Quit 菜单 / Cmd+Q** 永不变成 hide。  
3. 所有窗口关闭后 app 仍可在菜单栏存活（activation policy 评估：`Accessory` vs `Regular`——**P1 保持 Regular**，避免 Dock 图标消失引发「app 没了」；P3 可评估）。

### Windows 特别规则

1. 用户默认更期望 X=退出 → 默认配置 `quit` + P2 询问更重要。  
2. 托盘可能被折叠：首次 hide 必须通知（P2）。  

---

## IPC / Commands（汇总）

| Command / Event | Phase | 方向 | 说明 |
|-----------------|-------|------|------|
| `window_get_policy` | P1 | FE→Rust | 当前生效策略（含 tray 是否实际可用） |
| `window_set_policy` | P1 | FE→Rust | 热更新 closeAction / trayEnabled 等 |
| `window_show_main` | P1 | FE→Rust / 内部 | Show 主窗 |
| `window_hide_main` | P1 | 内部 / 测试 | Hide |
| `window_quit` | P1 | FE→Rust | 请求退出（P2 可带 `force`） |
| `window://close-prompt` | P2 | Rust→FE | 需要 FE 询问关窗 |
| `window_close_decision` | P2 | FE→Rust | `{ action: 'hide'\|'quit', remember: bool }` |
| `window://exit-confirm` | P2 | Rust→FE | 需要 active work 确认 |
| `window_exit_decision` | P2 | FE→Rust | `{ proceed: bool, force: bool, hideInstead?: bool }` |
| `tray_set_status` | P2 | FE→Rust | `{ runningAgents, runningTasks, label? }` |
| `window://tray-action` | P3 | Rust→FE | 新建会话 / 打开设置等 |
| autostart plugin APIs | P3 | FE↔Rust | enable/disable |

命名实现时可按仓库 IPC 惯例微调；**语义不变**。

---

## Settings UI 结构（三期共用）

```
通用设置
  · 语言 / 主题 / 密度 / 终端 / 回收站（既有）
  · 窗口与后台（新）
      [关闭窗口时]     dropdown: 隐藏到托盘 | 退出 hip | 每次询问(P2)
      [启用系统托盘]   switch
      [始终显示托盘]   switch（P1 可选 / P3 暴露）
      [开机时启动 hip] switch（P3）
      [任务完成时通知] switch（P3）
```

`启用系统托盘=false` → 关闭相关子项禁用，并显示说明。

---

## i18n Keys（草案）

```
settings.windowSection
settings.closeAction
settings.closeActionDesc
settings.closeActions.hide
settings.closeActions.quit
settings.closeActions.ask
settings.trayEnabled
settings.trayEnabledDesc
settings.trayAlwaysVisible
settings.trayAlwaysVisibleDesc
settings.launchAtLogin
settings.launchAtLoginDesc
settings.notifyOnAgentComplete
settings.notifyOnAgentCompleteDesc

tray.showMain
tray.quit
tray.openSettings
tray.newSession
tray.interruptAgents
tray.tooltipIdle
tray.tooltipRunning          // "{{agents}} agents · {{tasks}} tasks"
tray.hideHintTitle
tray.hideHintBody

dialog.closeWindowTitle
dialog.closeWindowRemember
dialog.exitConfirmTitle
dialog.exitConfirmBody
dialog.exitConfirmHide
dialog.exitConfirmQuit
dialog.cancel
```

五语言：`zh-CN` `zh-TW` `en` `ja` `ko` 同步。

---

## Security & Lifecycle

1. Hide **不**降低权限模型；工具沙箱不变。  
2. Quit 必须继续：kill sidecar、PTY、SSH、discovery 文件（现逻辑）。  
3. 单实例勿把恶意 deep-link 参数当 shell（P3 若传路径需校验）。  
4. 通知内容不泄露 API key / 完整 prompt。  

---

## Rollout Plan

| Phase | 发布形态 | 回滚 |
|-------|----------|------|
| P1 | 功能开关可选：`HIP_TRAY=0` 强制旧行为（开发逃生） | 还原 CloseRequested 为 always exit；去 tray feature |
| P2 | 依赖 P1 | `closeAction` 强制 quit；跳过 dialog |
| P3 | 依赖 P2 通知通道可选独立 | 关 autostart / notify 即可 |

文档：

- README「关闭与托盘」短节。  
- CLAUDE.md gotcha：E2E 勿依赖关窗=退出 unless policy quit。  

---

## PR 拆分建议

### Phase 1

| PR | 内容 |
|----|------|
| P1-a | protocol `WindowConfig` + hip.toml 读写 normalize + 单测 |
| P1-b | Rust tray + CloseRequested 策略 + commands（无设置 UI 可用默认） |
| P1-c | 单实例插件 |
| P1-d | GeneralSettings UI + i18n + FE 推送 policy |
| P1-e | README + e2e 适配 |

### Phase 2

| PR | 内容 |
|----|------|
| P2-a | 关窗 ask 对话框 + closePromptSeen |
| P2-b | ExitRequested prevent + active work 确认 |
| P2-c | tray_set_status + tooltip |
| P2-d | 首次 hide 系统通知 |

### Phase 3

| PR | 内容 |
|----|------|
| P3-a | autostart + startHiddenOnLogin |
| P3-b | agent complete 通知 + click focus |
| P3-c | 托盘菜单扩展 |

---

## Open Questions

| ID | 问题 | 倾向 | 决策状态 |
|----|------|------|----------|
| Q1 | P1 老用户默认 hide 还是 quit？ | **quit** 兼容；设置推荐 hide | 建议锁定 quit |
| Q2 | P1 是否实现 `trayAlwaysVisible=false`？ | P1 默认 always on；逻辑可后置 | 开放 |
| Q3 | Active work 是否含 knowledge dirty draft？ | P2 不含；P3 再议 | 开放 |
| Q4 | Cmd+Q 有 active work 时是否允许「隐藏」按钮？ | 是（P2 文案） | 建议锁定 |
| Q5 | macOS 是否改为 `Accessory` 去 Dock？ | **否**（P1–P2） | 建议锁定 |
| Q6 | 开发模式单实例？ | 默认关；env 可开 | 建议锁定 |
| Q7 | `ask` 是否在 P1 设置中露出？ | 否，P2 再露 | 建议锁定 |

---

## Success Metrics（产品，可选）

- 关窗后 5 分钟内「非自愿退出」导致的 agent 中断率下降。  
- 设置中 hide 选用率；托盘 Show 使用次数。  
- 退出确认取消率（过高说明误触退出多）。  
- CLI attach 成功率在「用户自认已关窗」场景提升。  

---

## Appendix A — 与当前代码的最小差分点

```rust
// 今日
WindowEvent::CloseRequested { .. } => { app_handle.exit(0); }

// P1 目标伪代码
WindowEvent::CloseRequested { api, .. } => {
    let policy = app_handle.state::<WindowPolicy>();
    if policy.should_hide_on_close() {
        api.prevent_close();
        let _ = show_tray_if_needed(&app_handle);
        let _ = main_window.hide();
    } else {
        app_handle.exit(0);
    }
}
```

`ExitRequested` 清理逻辑 **保持**；P2 增加 `prevent_exit` + force 标志，避免确认前误杀 sidecar。

---

## Appendix B — Phase 对照总表

| 能力 | P1 | P2 | P3 |
|------|----|----|-----|
| closeAction hide/quit | ✅ | ✅ | ✅ |
| closeAction ask | 类型预留 | ✅ UI | ✅ |
| 托盘 Show / Quit | ✅ | ✅ | ✅ |
| 托盘左键 Show | ✅ | ✅ | ✅ |
| 单实例 | ✅ | ✅ | ✅ |
| 无 tray fallback | ✅ | ✅ | ✅ |
| 首次关窗引导 | — | ✅ | ✅ |
| 退出 active work 确认 | — | ✅ | ✅ |
| 托盘 tooltip 状态 | — | ✅ | ✅ |
| 首次 hide 系统提示 | — | ✅ | ✅ |
| 开机自启 | — | — | ✅ |
| Agent 完成通知 | — | — | ✅ |
| 托盘扩展菜单 | — | — | ✅ |

---

## Appendix C — 验收检查清单（发布前）

### P1

- [ ] hide 后 `ps` 仍有 hip；sidecar 端口通  
- [ ] CLI `hip doctor` 在 hide 后成功  
- [ ] quit 后 discovery 文件删除、无僵尸 sidecar  
- [ ] 设置往返 hip.toml 正确  
- [ ] macOS Cmd+Q 退出  
- [ ] Windows X + quit 退出；X + hide 托盘  
- [ ] 二次启动单实例  
- [ ] 五语言设置字符串  

### P2

- [ ] 首次关窗对话框  
- [ ] 记住选择写入 toml  
- [ ] running agent 时退出可取消  
- [ ] tooltip 更新  

### P3

- [ ] 登录项开关  
- [ ] 隐藏时完成通知  
- [ ] 通知点击回前台  

---

*End of spec. Implementation should follow AGENTS.md: surgical changes, phase-by-phase commits, verify each phase before the next.*
