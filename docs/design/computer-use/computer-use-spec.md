# 通用设置 · Compute Use（电脑操控）功能 Spec

- 系列：`docs/design/computer-use/`
- 配套：`computer-use-plan.md`（执行计划：PR 拆解、文件级任务、测试与验收、节奏与风险）；`computer-use-preview.html`（方案总览 + 设置页/审批/双模式流程交互原型，浏览器直接打开）
- 状态：待评审
- 日期：2026-08-13
- 前置基线：
  - `src/components/account/GeneralSettings.tsx`（通用设置页，Switch/Dropdown 行 + `hipConfigStore.updateSection`）
  - `packages/protocol/src/hip-config.ts` + `src-tauri/src/hip_config.rs`（hip.toml 分区镜像）
  - `packages/sidecar/src/session/tools/`（LangChain 工具 + HITL `requestApproval` + `bridge` UI 桥，见 `terminal.ts` 的 `session:terminalExec:request` 往返模式）
  - `src/lib/attachmentEligibility.ts`（models.dev `attachment` 视觉能力信号 + 多模态判定，本功能复用同一信号）

---

## 1. 背景与目标

### 1.1 背景

hip 目前只通过 shell / 文件 / Web 工具间接操作机器，无法驱动真实 GUI 应用（点击、输入、读取屏幕）。
用户希望 Agent 能"操作电脑"：看到屏幕、执行鼠标键盘动作、验证效果——即业界通称的 **Computer Use**（Anthropic）/ **GUI Agent**（UI-TARS）能力。

关键约束：**模型不一定有多模态（视觉）能力**。截图感知依赖视觉模型；
非视觉模型（或 models.dev 元数据缺失的自定义 provider）必须有一条不依赖图像的降级路径。

### 1.2 目标（v1）

1. 通用设置新增 **Compute Use** 区块：总开关、感知模式、审批策略、系统权限状态与引导。
2. 给会话内的 Agent 增加一个 `computer` 工具（Anthropic `computer_20250124` 动作词汇表），
   由 Rust 原生层执行截图与输入注入。
3. **双感知模式**，随模型能力自动解析：
   - `vision`：截图 → 图像内容块 → 模型输出屏幕坐标（需要多模态模型）；
   - `accessibility`：可访问性树（macOS AX / Windows UIA）文本快照 → 模型输出元素 ID 或选择器（任何文本模型可用）。
   - `auto`（默认）：当前模型支持视觉 → `vision`；不支持或未知 → 降级 `accessibility`，UI 明示原因。
4. 安全兜底：输入动作 HITL 审批、锁屏禁用、执行期用户可见指示。

### 1.3 非目标（v1）

- Set-of-Marks（OmniParser 等检测模型给元素画编号框）——v1.5，坐标定位的精度增强项。
- 应用黑名单 / 敏感内容遮蔽（密码框自动隐藏输入）——v1.5。
- 浏览器场景优先走既有 web/browser 工具，不重复造浏览器自动化。
- **Linux 全平台不在 v1 范围**（X11 注入与 Wayland portal 跨发行版差异大，见 §7）；v1 只承诺 **macOS + Windows**。

---

## 2. 现状盘点（已核对代码）

| 层 | 现状 | 本功能挂接点 |
|---|---|---|
| 设置 UI | `GeneralSettings.tsx` 行式区块（标题+描述+右侧控件），`useHipConfigStore(s => s.updateSection('proxy', …))` 落盘 hip.toml | 新增 `computerUse` 区块，`updateSection('computerUse', …)` |
| 配置 | `HipConfig`（protocol）与 `hip_config.rs` serde 镜像，`set_hip_config` 重写会保留分区字段 | 新增 `[computerUse]` 分区，两端同步加类型 + resolver（默认值/clamp） |
| 模型能力 | models.dev catalog：`CatalogModel.attachment?: boolean` 即视觉信号；`attachmentEligibility.ts` 已有「当前模型 / 任一启用 agent 是否多模态」判定 | 复用同逻辑做 `isComputeUseEligible()`；`attachment` 缺失 → 视为未知（保守降级） |
| 工具 | sidecar `buildAllTools`（LangChain StructuredTool）；`requestApproval({title, toolName, kind, content, meta})` → UI HITL 弹窗（`kind: read\|edit\|delete\|execute\|fetch\|other`）；`bridge.send` + `waitForUi` 往返 | 新增 `tools/computer-use.ts`，`kind: 'input'`（新增），桥接 `session:computerUse:request/result` |
| 原生层 | Tauri v2 Rust 核；命令注册在 `src-tauri/src/lib.rs`，capabilities 白名单 | 新增 `src-tauri/src/computer_use.rs`：xcap 截图 + enigo 输入 + 权限探测 + 锁屏检测 |
| 协议 | `packages/protocol/src/` ServerMessage/ClientMessage | 新增 `session:computerUse:*` 消息对 |
| 会话模型 | `SessionSummary.surface: chat\|code\|terminal` | v1 仅 chat surface 暴露 `computer` 工具 |

---

## 3. 参考实现调研结论

| 参考 | 借鉴点 |
|---|---|
| Anthropic Computer Use（`computer_20250124`，platform.claude.com） | 动作词汇表与工具 schema：`key/type/cursor_position/mouse_move/left_click/right_click/double_click/triple_click/left_click_drag/scroll/hold_key/wait/screenshot`；`display_width_px/height_px/display_number` 注入；**应用侧负责实现动作**（截图/注入）。新版本另有 `zoom` + `enable_zoom`。 |
| UI-TARS-desktop（Bytedance，Electron） | 权限流：macOS Screen Recording（截图）+ Accessibility（输入），`@computer-use/node-mac-permissions` 探测并深链系统设置；坐标回读基于「主显示器 + 缩放换算」。 |
| codex（`codex-rs/config_requirements.rs`） | `computer_use` 需求门 + `allow_locked_computer_use` 默认 **false**（锁屏禁止执行），作为安全基线。 |
| hermes-agent（`skills/computer-use/SKILL.md`）+ Touchpoint | **非视觉模型路径**：`mode: ax` 返回纯可访问性树文本（AXButton/Button/push button 等角色名），动作按元素 ID 派发；`som/vision/ax` 三模式并存。Touchpoint `no-vision` 模式同思路，并在动作后自动附加状态验证线索。 |
| vibeengines 系统设计 / t8r.tech / bettyguo | 定位（grounding）优先级共识：**可访问性矩形 → 截图标注（SoM）→ 原始坐标兜底**；每次动作后必须用新观察验证效果；不可逆动作需审批门。 |
| Tauri 系实现（shlawgathon/Computer-Use、clickyX、tauri-mcp） | 技术栈验证：`xcap`（跨平台截图，macOS ScreenCaptureKit/CGWindowList、Windows DXGI）+ `enigo`（输入注入）；macOS 上 `CGEvent` 合成点击可不劫持物理光标；捕获可排除自身窗口（HUD/浮层不出现在截图里）。 |

---

## 4. 方案总览

```
用户在通用设置开启 Compute Use
        │
        ├─ 能力解析（UI，每次模型切换重算）
        │    mode = auto → (模型多模态 ? vision : accessibility)
        │
Agent 会话（chat surface）
        │  buildAllTools() 注入 computer 工具（受配置 + 能力 + 平台 + 权限门控）
        ▼
sidecar computer 工具 ── requestApproval (HITL, kind:'input') ──► UI 审批弹窗
        │                                                        │
        │ bridge.send 'session:computerUse:request'              │ invoke Tauri 命令
        ▼                                                        ▼
        UI ◄────────────── 'session:computerUse:result' ── Rust computer_use 模块
                                                          (xcap 截图 / enigo 注入 / 锁屏与权限检查)
```

执行通道选型：截图与输入注入放 **Rust 原生层**、由 **sidecar→UI 桥** 触发，理由：
1. macOS TCC（屏幕录制/辅助功能）绑定应用本体，Node sidecar 进程拿不到；
2. 与 `terminal_exec` 的桥接模式完全一致，复用 `waitForUi` / HITL / 超时取消机制；
3. 原生层统一处理多显示器坐标换算、缩放、锁屏检测，sidecar 只做协议翻译。

---

## 5. 详细设计

### 5.1 配置：`[computerUse]` hip.toml 分区

```toml
[computerUse]
enabled = true          # 总开关，默认 false
mode = "auto"           # auto | vision | accessibility
approval = "ask"        # ask（每动作）| askOnce（每回合一次）| auto（plan 模式）
allowLockedScreen = false
maxStepsPerTurn = 20    # 每回合动作上限，clamp [1, 100]
```

- protocol：`ComputerUseConfig` + resolver（`resolveComputerUseConfig`：模式非法回退 `auto`、步数 clamp、默认值），契约测试照 `hipConfig.contract.test.ts`。
- Rust：`hip_config.rs` 镜像 struct（`#[serde(rename_all = "camelCase")]`），确保 `set_hip_config` 重写不丢字段。
- 配置只读分发：由 `buildAllTools` opts 传入 sidecar（同 `sandbox`/`agentLoop` 现状），不在会话中途热切换。

### 5.2 能力检测与模式解析（多模态不确定性处理）

信号源（按优先级）：

1. **models.dev catalog** `models[modelID].attachment === true` → 多模态（与附件按钮同一信号，已落地验证）。
2. 用户自声明：`[computerUse] mode = "vision"` 显式指定时，即使 catalog 缺失也按 vision 尝试（工具 schema 不变，失败由模型侧报错可见）。
3. 均无 → **未知**，`auto` 下保守降级 `accessibility`。

复用并泛化 `src/lib/attachmentEligibility.ts`，新增：

```ts
// src/lib/computeUseEligibility.ts（纯函数 + 单测）
type ComputeUseMode = 'vision' | 'accessibility'
interface ComputeUseResolution {
  available: boolean          // 配置开启 && 平台支持 && 权限就绪
  mode: ComputeUseMode        // 实际生效模式
  degraded: boolean           // auto 因模型无视觉能力而降级
  reason?: 'disabled' | 'no-multimodal-model' | 'platform-unsupported' | 'no-permission'
}
function resolveComputeUseMode(cfg, currentModelKey, agents, catalog, platform, permissions): ComputeUseResolution
```

解析对象是**当前会话模型**（`activeModel`），与附件按钮一致；无当前模型时看是否存在任一多模态启用 agent（沿用 `findMultimodalAgentModelKey`）。

UI 呈现：
- Composer 工具入口（类似 AttachmentButton）：不可用时禁用 + tooltip 给出 `reason`；
- 通用设置区块内显示「当前模型：xx/yy · 视觉：是/否/未知 → 生效模式：vision/accessibility（已降级）」一行说明。

### 5.3 原生层：`src-tauri/src/computer_use.rs`

依赖：`xcap`（截图）、`enigo`（输入）、`core-graphics`（macOS 合成点击，可选启用）。

命令（`lib.rs` 注册，capabilities 白名单加 `core:default` 之外的显式项）：

```rust
computer_use_permissions() -> PermissionsStatus
// { screenCapture: bool, input: bool, platform: 'macos'|'windows', supported: bool, display?: { width, height, scale } }
// 非 macOS/Windows → supported:false（v1 平台白名单，见 §1.3）

computer_use_screenshot() -> { ok, image_base64, mime, width, height } | { ok:false, code:'no_permission'|'locked'|'unsupported' }
// 主显示器；按 display_width_px 等比缩放（默认长边 1280，配置可调）；PNG（v1 不做 JPEG 质量旋钮）

computer_use_input(ActionInput) -> { ok, after?: screenshot(可选) }
// ActionInput = { action: 'mouse_move'|'left_click'|…, coordinate?, text?, … }（§5.4 同 schema）
```

安全约束（每次执行前强制校验）：

1. **锁屏拒绝**：macOS `CGSessionCopyCurrentDictionary`（kCGSSessionOnConsoleKey）；Windows WTS 会话查询。锁屏或有其他用户控制台 → 返回 `locked`，除非 `allowLockedScreen=true`（默认 false，同 codex 基线）。
2. **权限拒绝**：macOS 无 Screen Recording / Accessibility 授权 → 返回 `no_permission`，UI 引导跳系统设置。
3. **截图排除 hip 自身窗口**（macOS `CGWindowListCreateImage` + 窗口层过滤，参考 shlawgathon/Computer-Use；Windows v1 先接受整屏，回读时高亮提示）。
4. **输入不劫持物理光标**（macOS 用 `CGEvent` 合成点击，enigo 兜底；Windows 用 enigo）。
5. 坐标换算：模型输出以 `display_width_px/height_px` 为基准 → Rust 按实际分辨率 × scale 换算（UI-TARS 同款）。

`PermissionsStatus` 由设置页轮询/手动刷新：macOS 用 `CGPreflightScreenCaptureAccess` / `AXIsProcessTrusted`；Windows 恒为 true（UIA/SendInput 无需授权）。

### 5.4 sidecar 工具：`packages/sidecar/src/session/tools/computer-use.ts`

单工具 `computer`，schema 对齐 Anthropic `computer_20250124`（v1 子集，不含 triple_click/hold_key 可后补）：

```ts
{
  action: 'screenshot'|'cursor_position'|'mouse_move'|'left_click'|'right_click'|'double_click'
        | 'left_click_drag'|'scroll'|'key'|'type'|'wait',
  coordinate?: [number, number],        // mouse_move/click/scroll/drag
  start_coordinate?: [number, number],  // drag
  text?: string,                        // type/key
  scroll_direction?: 'up'|'down'|'left'|'right',
  scroll_amount?: number,
  duration?: number,                    // wait
  element_id?: string,                  // 仅 accessibility 模式：定位元素
}
```

构建时注入：`display_width_px/height_px`（来自 `computer_use_permissions` 缓存）、`mode`、`approval`、`maxStepsPerTurn`、`bridge`、`requestApproval`。

两条执行路径：

**vision 模式**
1. `screenshot` → 桥接 Rust 截图 → 返回 image content block（走 sidecar 现有 messages 协议，参考 `media.ts` 的 base64 注入）。
2. 输入动作 → `requestApproval({ toolName:'computer', kind:'input', content:'<动作描述>', meta:{callId} })` → 桥接 Rust 注入 → 返回结果 +（可选）回读截图。

**accessibility 模式（非视觉降级路径）**
1. `screenshot` → 返回**文本快照**而非图像：前台应用的可访问性树，格式为带索引行：
   ```
   [1] AXButton "提交" role=button enabled
   [2] AXTextField "" role=textfield focused
   ```
   （macOS AXUIElement 递归 + Windows UIA；深度/节点数上限 200，超限截断并提示 `tree truncated, call screenshot with focus window only`。）
2. 输入动作增加 `element_id` 参数：由元素索引解析为屏幕坐标（AX rect）后派发原生点击；`type` 优先走 `AXUIElementSetAttributeValue` / UIA ValuePattern 直接赋值（不模拟键盘）。
3. 动作结果自动附验证线索（Touchpoint 模式）：`(focused window changed: "Safari")` / `(no change detected)`，供模型在没有截图的情况下判断状态变化。
4. 树快照带 `stale` 语义：下一次 `screenshot` 前旧索引失效，工具描述里写明「每步重新截图」。

审批策略映射：
- `ask` → 每个非 `screenshot`/`cursor_position` 动作都 `requestApproval`；
- `askOnce` → 回合内首次输入动作审批后，其余放行（sidecar 内按 sessionId 记录本回合已批状态，同 `isApproved` 机制）；
- `auto` → 仅 plan 模式软审批（现有 `planMode` 透传）。
- `screenshot` / `cursor_position` / `wait` 只读，永不审批。

工具注入门控：`buildAllTools` 中仅在 `resolveComputeUseMode(...).available` 为真时注册（配置关、平台不支持、权限缺失 → 工具不存在，模型不可见，避免幻觉调用）。

### 5.5 协议与桥接消息

`packages/protocol/src/message-model.ts`（或 session-events）新增：

```ts
// sidecar → UI
{ type: 'session:computerUse:request', sessionId, callId, payload: { kind: 'screenshot' } | { kind: 'input', action: ActionInput } }
// UI → sidecar
{ type: 'session:computerUse:result', sessionId, callId, ok, ...screenshot|...inputResult, error? }
```

UI 侧 handler（对应 `terminalLifecycle` 式集中收口或 sessionActions 分发）：收到 request → `invoke('computer_use_screenshot' | 'computer_use_input', …)` → 回 `result`。超时（默认 15s，截图 5s）走 `waitForUi` 的 signal 取消。

### 5.6 通用设置 UI（`GeneralSettings.tsx` 新区块）

位置：proxy 区块之后、`ContextMenuSettings` 之前；`COMPUTE_USE` feature flag 门控（`src/components/chat/feature.ts` 同款常量）。

1. **总开关行**（Switch）：关闭时其余行灰化；开启时若平台不支持/权限缺失 → 开关旁警示 + 打开引导。
2. **感知模式行**（Dropdown：auto/vision/accessibility）+ 说明文字「当前模型 vision 能力：是/否/未知 · 生效模式：…（已降级）」。
3. **审批策略行**（Dropdown：ask/askOnce/auto）。
4. **系统权限行**（仅 macOS 展示两项状态 + 「打开系统设置」按钮；Windows 显示「无需额外授权」；非 macOS/Windows 平台显示「当前平台暂不支持」）：
   - 屏幕录制（截图所需）
   - 辅助功能（输入注入所需）
   - 手动「重新检测」按钮 → `computer_use_permissions()`。
5. 高级：`allowLockedScreen` Switch（默认关，警示文案）、`maxStepsPerTurn` 数字输入（复用 trashRetention 输入样式）。

i18n：`settings.computerUse*` 键，五语言同步（zh-CN/en/ja/ko/zh-TW），`translation-keys.test.ts` 守护。

### 5.7 会话内可见性

- 输入动作审批弹窗：复用现有 PermissionRequestPayload 渲染（新增 `kind:'input'` 的图标/文案，显示动作摘要与坐标）。
- 执行期间：窗口 title/tray 显示「Compute Use 运行中」徽标 + 全局快捷键（Esc）中断本轮（`AbortController` 透传，同 stop 语义）。
- 截图不入会话持久化（不进 sessions DB / 附件表）：只在工具往返内存中存在，历史回放显示「[截图] computer screenshot 1200×800」占位文本。

---

## 6. 测试与验收

### 6.1 单元/契约

- protocol：`ComputerUseConfig` resolver（默认值/clamp/非法值回退）、新消息类型契约测试。
- UI：`resolveComputeUseMode` 全分支（多模态/未知/自定义 provider/平台/权限组合）；`GeneralSettings` 区块渲染与开关联动（照 `GeneralSettings.test.tsx` 模式）。
- sidecar：工具 schema 校验（非法 action/坐标越界拒绝）、审批策略三态、accessibility 快照解析（fixture 树）、`askOnce` 回合状态。
- Rust：坐标换算（scale/dpi）、锁屏检测桩、输入注入拒绝路径（无权限/锁屏）——`#[cfg(test)]` 注入假 backend。

### 6.2 E2E（e2e/specs/）

- 设置页开启开关 → hip.toml 出现 `[computerUse]` → 重启后保留。
- 关闭/权限缺失时 Composer 工具入口禁用 + tooltip。
- 假模型（E2E 模拟钩子，`src/domain/e2eHooks.ts`）触发 `computer` 工具 → 审批弹窗 → 允许 → Rust stub 返回 → 时间线出现 tool step（E2E 下 Rust 注入走 stub，不真实动鼠标）。

### 6.3 手工验收（dogfood）

- macOS：真实 Screen Recording/Accessibility 授权后，Claude（多模态）执行「打开计算器点 1+1=」；一个文本-only 本地模型走 accessibility 模式点按系统设置里的开关。
- 锁屏下调用 → 返回 `locked` 错误。
- Esc 中断 → 会话停止，无残留输入注入。

---

## 7. 风险与开放问题

| 风险/问题 | 影响 | 对策/决策 |
|---|---|---|
| macOS TCC 授权对 dev（终端）与打包 app 是两个主体 | dev 阶段权限探测不一致 | 文档写清 + 设置页重检按钮；E2E 走 stub |
| enigo 在 macOS 移动物理光标 | 体验 | macOS 优先 CGEvent 合成（core-graphics），enigo 仅兜底 |
| Linux 全平台缺位（X11 注入 + Wayland portal/libei 跨发行版差异大） | 平台覆盖 | v1 明确不支持；后续版本单独评估 X11/AT-SPI 与 Wayland portal 两条路径 |
| 非视觉模型纯 AX 树对 canvas/自绘 UI 覆盖不足 | accessibility 模式盲区 | 工具描述明示局限；v1.5 以 SoM（OmniParser）补视觉-文本混合路径 |
| 截图进入模型上下文 = 隐私面扩大 | 数据安全 | 截图不落盘/不进 DB；审批文案明示「屏幕内容将发送给模型」；v1.5 应用黑名单+敏感遮蔽 |
| 坐标型模型输出与分辨率换算误差 | 点错目标 | 每次动作后回读截图验证；display 尺寸在工具 schema 注入，模型按此基准输出 |
| `maxStepsPerTurn` 之外模型死循环 | 会话失控 | 既有 doom_loop_strategy + 回合步数硬上限；Esc 中断 |
| 自定义 provider 无 catalog 元数据（vision 未知） | auto 误判 | 保守降级 accessibility + 设置页允许用户显式选 vision 覆盖 |

---

## 8. 分阶段落地计划（每 PR 独立可合，详见 computer-use-plan.md）

```
P0 原生层 + 配置（Rust computer_use.rs 仅 macOS/Windows 实现、hip.toml 分区、permissions 命令、契约测试）
   │
P1 vision 路径（sidecar computer 工具 + 桥接消息 + HITL kind:'input' + 审批策略）
   │
P2 accessibility 路径（AX/UIA 文本快照 + element_id 动作 + 验证线索）
   │
P3 通用设置 UI + 能力解析展示 + i18n 五语言 + E2E
   │
P4 加固（锁屏告警体验、窗口排除完善、dogfood、SoM 预研）
```

- P0→P1→P2 串行；P3 依赖 P0（配置/权限探测），可与 P1/P2 并行开发 UI 骨架；P4 收尾。
- 每 PR 门禁：`yarn tsc` + `yarn test`（paid LLM 测试注意移开 auth.json）+ `cargo test`。
- 里程碑验收：P2 合入后，非多模态模型可完整跑通「accessibility 模式」端到端（本需求核心约束）。

## 附：参考链接

- Anthropic Computer Use tool：https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
- Anthropic computer-use-demo（实现参考）：https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo
- UI-TARS-desktop：https://github.com/bytedance/UI-TARS-desktop
- hermes-agent computer-use skill（som/vision/ax 三模式）：https://github.com/NousResearch/hermes-agent/blob/main/skills/computer-use/SKILL.md
- Touchpoint（no-vision 模式）：https://github.com/Touchpoint-Labs/Touchpoint
- codex computer-use 需求门（allow_locked_computer_use）：`codex-rs/config/src/config_requirements.rs`
- xcap（截图）：https://github.com/nashaofu/xcap · enigo（输入）：https://github.com/enigo-rs/enigo
