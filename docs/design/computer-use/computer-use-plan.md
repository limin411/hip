# 通用设置 · Compute Use（电脑操控）—— 执行计划

> 系列：`computer-use` ｜ spec：`computer-use-spec.md` ｜ 总览：`computer-use-preview.html`
> 本文档按 spec §5/§8 落地，P0–P4 五个阶段，每阶段独立提交、可回滚。
> 平台承诺：**仅 macOS + Windows**（spec §1.3）；Linux 一律返回 `supported:false`，UI 显示「当前平台暂不支持」。

---

## 0. 范围与原则（执行约束）

- **双感知模式是硬要求**：vision（截图坐标）与 accessibility（AX/UIA 文本树 + element_id）两条路径都必须打通端到端；`auto` 模式下非多模态模型自动降级 accessibility（spec §5.2）。
- **执行通道**：截图/输入注入全部走 Rust 原生层，sidecar 经 UI 桥触发（同 `terminal_exec` 桥接模式），sidecar 不做任何原生调用。
- **安全基线**：锁屏拒绝（`allowLockedScreen` 默认 false）；输入动作走 HITL；截图不落盘、不进 sessions DB。
- **能力信号**：复用 models.dev `attachment` 字段与 `attachmentEligibility.ts` 判定逻辑，不新造第二套多模态检测。
- **测试纪律**：`yarn tsc` + `yarn test` + `cargo test` 每 PR 全绿；付费 LLM 测试护栏按 CLAUDE.md（先移开 `~/.hip/config/auth.json`）。
- **i18n 五语言同步**：每个 PR 引入新 key 时一次补齐 zh-CN/en/ja/ko/zh-TW，`translation-keys.test.ts` 守护。

---

## P0 · 原生层 + 配置（地基）

**文件**：`src-tauri/src/computer_use.rs`（新）、`src-tauri/src/hip_config.rs`、`src-tauri/src/lib.rs`、`src-tauri/Cargo.toml`、`src-tauri/capabilities/*`、`packages/protocol/src/hip-config.ts`、`packages/protocol/src/hipConfig.contract.test.ts`（补）

1. `Cargo.toml`：加 `xcap`、`enigo`；macOS target 加 `core-graphics`（CGEvent 合成点击）。
2. `hip_config.rs`：`ComputerUseConfig` struct（`enabled/mode/approval/allowLockedScreen/maxStepsPerTurn`），`#[serde(rename_all = "camelCase")]`，并入 `HipConfigRoot`；`set_hip_config` 重写保留字段（照 `proxy` 段模式）。
3. `computer_use.rs`（macOS/Windows 双实现，`#[cfg]` 分流；其他平台 stub 返回 `supported:false`）：
   - `computer_use_permissions()`：macOS `CGPreflightScreenCaptureAccess` / `AXIsProcessTrusted` + 主显示器尺寸/scale；Windows 恒 true + 主显示器尺寸。
   - `computer_use_screenshot()`：xcap 主显示器捕获，按 `display_width_px` 等比缩放（默认长边 1280）；macOS 排除 hip 自身窗口（CGWindowList 层过滤）；返回 PNG base64。
   - `computer_use_input()`：enigo 注入；macOS 点击走 CGEvent 合成（不劫持物理光标），enigo 兜底。
   - 前置校验：锁屏（`CGSessionCopyCurrentDictionary` / WTS）→ `locked`；权限缺失 → `no_permission`。
   - `#[cfg(test)]` 假 backend（锁定/权限/坐标换算单测，不真动鼠标）。
4. `lib.rs` 注册三命令 + capabilities 白名单显式列出。
5. protocol：`ComputerUseConfig` + `resolveComputerUseConfig`（默认值/clamp/非法值回退：mode 非法→`auto`、`maxStepsPerTurn` clamp [1,100]）+ 契约测试。

**验收**：`cargo test` 全绿；`yarn test src` 契约用例过；手写 hip.toml `[computerUse]` 后 `set_hip_config` 往返不丢字段。

---

## P1 · vision 路径（sidecar 工具 + 桥接 + HITL）

**文件**：`packages/sidecar/src/session/tools/computer-use.ts`（新）、`packages/sidecar/src/session/tools/index.ts`、`packages/protocol/src/message-model.ts`（新消息对）、`packages/protocol/src/session-events.ts`（如消息在此登记）、`src/domain/sessionStore/…`（UI 侧 handler 收口点）、`src/domain/actions/…`、`src/components/…/PermissionRequestModal`（kind 扩展）

1. protocol 新增 `session:computerUse:request/result` 消息对（spec §5.5 形状）。
2. sidecar `buildComputerUseTool(opts)`：schema 对齐 `computer_20250124` v1 子集（11 个 action + coordinate/text/scroll_*/duration 参数）；构建时注入 `display_width_px/height_px`、`mode`、`approval`、`maxStepsPerTurn`。
   - `screenshot`/`cursor_position`/`wait` 只读，永不审批；输入动作 `requestApproval({ toolName:'computer', kind:'input', … })`。
   - 桥接复用 `waitForUi` + `bridge.send`；截图超时 5s、输入 15s，signal 取消。
   - 回合步数计数（`maxStepsPerTurn` 硬上限，超限返回提示）。
3. `index.ts` 注入门控：`resolveComputeUseMode(...).available` 为真才注册（先以最小实现落地，P3 与 UI 共用同一纯函数）。
4. UI 侧：收到 request → `invoke('computer_use_screenshot' | 'computer_use_input')` → 回 result；审批弹窗渲染 `kind:'input'`（动作摘要 + 坐标 + 「屏幕内容将发送给模型」提示）。
5. 测试：工具 schema 非法值拒绝（越界坐标/未知 action）、审批三态（ask/askOnce/auto）、超时与取消、门控（配置关 → 工具不存在）。

**验收**：E2E 模拟钩子触发 `computer` 工具 → 审批弹窗 → 允许 → Rust stub 返回 → 时间线 tool step；`yarn test:longrun-unit` 不回归。

---

## P2 · accessibility 路径（非视觉模型降级通道）

**文件**：`src-tauri/src/computer_use.rs`（AX/UIA 树）、`packages/sidecar/src/session/tools/computer-use.ts`、`packages/sidecar/src/session/tools/computer-use.test.ts`（新）

1. Rust 新增 `computer_use_ax_tree()`：
   - macOS：前台应用 AXUIElement 递归（角色/标题/值/enabled/focused + 屏幕矩形），深度/节点上限 200，超限截断标记。
   - Windows：UIA 树同构输出（`Button`/`Edit`/`ListItem` 等角色名，含 `AutomationId`/`Name`）。
2. sidecar accessibility 分支：
   - `screenshot` → 返回文本快照（带索引行 `[n] Role "Name"`）而非图像；附 `stale` 语义说明。
   - 输入动作接受 `element_id`：由索引查树拿屏幕矩形 → 坐标派发；`type` 优先 AXUIElement/UIA ValuePattern 直接赋值。
   - 动作结果自动附验证线索：`(focused window changed: "Safari")` / `(no change detected)`。
3. 测试：fixture 树解析单测（macOS/Windows 两套）、element_id 越界/过期错误、验证线索拼接。

**验收**：一个文本-only 本地模型在 macOS 上以 accessibility 模式点按系统设置开关（dogfood 手工项）；纯函数单测覆盖两平台 fixture。

---

## P3 · 通用设置 UI + 能力解析展示 + E2E

**文件**：`src/lib/computeUseEligibility.ts`（新 + 单测）、`src/components/account/GeneralSettings.tsx`、`src/components/account/GeneralSettings.test.tsx`（补）、`src/components/chat/feature.ts`（`COMPUTE_USE` flag）、`src/i18n/{zh-CN,en,ja,ko,zh-TW}.ts`、Composer 工具入口（AttachmentButton 旁，门控复用）、`e2e/specs/`（新 spec 文件）

1. `computeUseEligibility.ts`：`resolveComputeUseMode(cfg, currentModelKey, agents, catalog, platform, permissions)` 纯函数，分支覆盖：多模态/未知/自定义 provider/平台不支持/权限缺失/显式 vision 覆盖。
2. `GeneralSettings.tsx` 新区块（`COMPUTE_USE` flag 门控，proxy 之后）：
   - 总开关（关 → 其余行灰化）；
   - 感知模式 Dropdown（auto/vision/accessibility）+ 动态说明行「当前模型 vision：是/否/未知 · 生效模式：…（已降级）」；
   - 审批策略 Dropdown（ask/askOnce/auto）；
   - 系统权限行（macOS 两项状态 + 「打开系统设置」+「重新检测」；Windows「无需额外授权」；其他平台「暂不支持」）；
   - 高级：`allowLockedScreen` Switch（默认关 + 警示）、`maxStepsPerTurn` 数字输入（复用 trashRetention 样式）。
   - 全部经 `updateSection('computerUse', …)` 落盘。
3. i18n 五语言补齐 `settings.computerUse*` 键。
4. E2E：开关开启 → hip.toml 出现 `[computerUse]` → 重启保留；关闭/权限缺失 → Composer 入口禁用 + tooltip；假模型触发工具 → 审批 → stub 返回（E2E 下 Rust 注入走 stub）。

**验收**：`GeneralSettings.test.tsx` 新区块用例 + `computeUseEligibility` 全分支；`yarn test`（auth.json 移开）与 `yarn tsc` 全绿；e2e 本 spec 全过。

---

## P4 · 加固与收尾

1. **锁屏体验**：设置页显示「当前屏幕已锁定」实时状态（permissions 命令附 locked 字段）；会话内 computer 工具返回 `locked` 时 UI 明示原因（非通用报错）。
2. **窗口排除完善**：Windows 侧排除 hip 自身窗口（`SetWindowDisplayAffinity` 或截图后裁切方案，选型后实现）；macOS 已排除的回归确认。
3. **会话可见性**：执行期 window title/tray「Compute Use 运行中」徽标 + Esc 中断本轮（AbortController 透传，同 stop 语义）。
4. **文档收尾**：`DESIGN.md` 补 Compute Use 小节；spec/plan 标「已实施」状态注；`docs/design/computer-use/preview.html` 与落地 UI 差异回填。
5. **dogfood**：多模态模型跑「打开计算器点 1+1=」；文本-only 模型跑 accessibility 流程；锁屏/中断/降级三场景留痕。
6. **SoM 预研**（v1.5 立项输入，不实现）：OmniParser 本地检测的接入点与 token 成本估算，写一页调研结论。

---

## 验收对照（spec §6 条目映射）

| spec 验收 | 落地点 |
|---|---|
| `[computerUse]` 配置落盘 + 往返不丢 | P0 hip_config + 契约测试 |
| 双模式端到端（vision 坐标 / accessibility element_id） | P1 + P2 |
| 非多模态模型 auto 降级 + UI 明示 | P2 + P3 `computeUseEligibility` |
| 输入动作 HITL（ask/askOnce/auto 三态） | P1 审批策略 |
| 锁屏拒绝执行 | P0 前置校验 + P4 状态展示 |
| 截图不落盘不进 DB | P1 桥接协议（仅内存往返）+ 回放占位文本 |
| 权限引导（macOS 双授权 + 深链系统设置） | P3 权限行 |
| Esc 中断 + 运行中徽标 | P4 |
| 平台承诺 macOS/Windows，其余「暂不支持」 | P0 stub + P3 UI |

## 依赖与节奏

```
P0（地基：原生层+配置）──► P1（vision 路径）──► P4（加固，依赖 P1）
                              │
P3（设置 UI）── 依赖 P0 ──────┘（UI 骨架可与 P1/P2 并行开发）
P2（accessibility）── 依赖 P0 ──► P4（AX 相关加固）
```

- P0 必须先行；P1、P2、P3 在 P0 合入后可由多人并行；P4 收尾串行。
- 每阶段 commit 粒度：Rust 变更与 sidecar/UI 变更分开提交（原生层回归需 `cargo test` 单独验证）。

## 风险与回滚

| 风险 | 处置 |
|---|---|
| macOS TCC 授权主体差异（dev 终端 vs 打包 app） | 设置页「重新检测」+ 文档说明；E2E 一律走 stub |
| enigo macOS 移动物理光标影响用户操作 | CGEvent 合成优先；失败才 enigo，且审批文案已明示 |
| AX/UIA 树对 canvas/自绘 UI 覆盖不足 | 工具描述明示局限；v1.5 SoM 补视觉-文本混合路径（P4 预研输出） |
| 截图误入敏感内容发送给模型 | 审批弹窗固定提示 + 截图不持久化；v1.5 应用黑名单/遮蔽 |
| 桥接消息与 terminal 桥混淆/路由错 | 独立消息对 + callId 前缀 `cu-`；单测覆盖 route |
| 阶段间接口漂移（Rust 命令签名 vs UI invoke） | P0 定契约测试；后续阶段只增不改 |
