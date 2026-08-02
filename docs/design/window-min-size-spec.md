# 主窗口与右栏最小尺寸 Spec

> 状态：已实现 v1 · 2026-08-02  

> 范围：Tauri 主窗口 OS 级 min、右栏打开时的软扩窗、面板级像素/百分比底  
> 相关实现：`tauri.conf.json` · `src/lib/rightPanelWidth.ts` · `src/routes/AppLayout.tsx` · `src/components/layout/sidebarWidth.ts` · `WindowLifecycleHost.tsx`  
> 不改动：右栏 titlebar 槽位（见 `right-panel-titlebar-slot-spec.md`）、侧栏宽度 clamp 语义、关窗/托盘策略

---

## 1. 问题摘要

| # | 问题 | 现状 | 影响 |
|---|------|------|------|
| P1 | 主窗口无 OS 级 min | `tauri.conf.json` 仅 default `1600×1100`，无 `minWidth`/`minHeight` | 用户可拖到无法点、无法读的尺寸 |
| P2 | 打开右栏硬目标偏高 | `RIGHT_PANEL_MAIN_TARGET = 1600`，且 `SCREEN_MIN = 1600` | 多数 13–14" / 分屏屏宽不够 → **从不扩窗**，小窗直接挤开右栏 |
| P3 | 「打开态」与「关闭态」若用两套窗口 min | 未实现，但容易误做成：开栏时抬高 `setMinSize` | 关栏后用户无法缩回；多显示器热插拔易卡死 |
| P4 | 面板 % min 与像素意图脱节 | 主栏 `minSize={34}`、右栏 `RIGHT_RAIL_MIN_PX`→% | 极窄窗上 % 与 px 冲突时行为不透明 |
| P5 | 扩窗只长大不缩 | `widenWindowForRightPanel` 只 enlarge | 正确；但缺「关栏是否还原」产品决策 |

**已有正解（保留）**：

- 右栏像素底 `RIGHT_RAIL_MIN_PX = 350`（titlebar + 内容可呼吸）
- 主内容区 live 测量 `[data-main-content-group]`
- 扩窗 clamp 到 `screen.availWidth`，失败则 fallback 原 open flow
- 左栏 `SIDEBAR_WIDTH_MIN/MAX = 200/480`

---

## 2. 目标与非目标

### 2.1 目标

1. **一层宽松 OS min**：任意状态下窗口不能拖过「基本可用」地板。  
2. **右栏可用像素底**：打开后右栏 ≥ 350px；主栏不被挤到不可用。  
3. **软扩窗（soft widen）**：开栏时若主内容区过窄且屏幕允许，**只 enlarge** 到舒适目标；屏不够则不扩、仍允许开栏。  
4. **单套窗口 min**：开/关右栏 **不**切换 `setMinSize`。  
5. **常量集中、可测**：尺寸数字进单一模块，unit test 覆盖公式；真机 smoke 覆盖 Tauri IPC。

### 2.2 非目标

- 不记住/不还原「开栏前窗口宽度」（v1；见 §7 可选 Phase 2）。  
- 不设「右栏打开时窗口 min = 主目标 + 侧栏」（避免 P3）。  
- 不改 default 启动尺寸 `1600×1100`（除非后续单独调）。  
- 不处理多窗口 / 弹出预览窗。  
- 不强制小屏禁止开右栏。

---

## 3. 分层模型

三层职责分离，禁止混用：

```
┌─────────────────────────────────────────────────────────────┐
│ L1  OS Window min     硬地板：用户拖拽/系统约束无法低于此     │
│     （Tauri minWidth/minHeight，全程恒定）                     │
├─────────────────────────────────────────────────────────────┤
│ L2  Soft widen        开右栏时的一次性 enlarge（可失败）       │
│     （rightPanelWidth.ts，只增不减）                          │
├─────────────────────────────────────────────────────────────┤
│ L3  Panel layout min  组内分配：主栏 % + 右栏 px→%             │
│     （react-resizable-panels in AppLayout）                  │
└─────────────────────────────────────────────────────────────┘
```

| 层 | 谁强制 | 失败时 |
|----|--------|--------|
| L1 | 窗口管理器 | 无法拖更小 |
| L2 | 开栏前 `await widen…` | return false，仍 expand 右栏 |
| L3 | 拖分割条 | 分割条顶住 min，不关栏 |

---

## 4. 数值提案

单位：**CSS 逻辑像素**（与 `window.innerWidth` / Tauri `LogicalSize` 一致）。

### 4.1 L1 — 主窗口 OS min（新增）

| 常量 | 值 | 依据 |
|------|-----|------|
| `WINDOW_MIN_WIDTH` | **880** | 侧栏关：主栏+composer 可用；侧栏开(200)+主栏仍 ≥ ~680 |
| `WINDOW_MIN_HEIGHT` | **560** | 对齐 `shellViewport` tier D 门槛（`h < 560` → fill）；titlebar+toolbar+composer+少量消息 |

**为何不是 1600 / 900：**

- 默认启动可以很大；min 只防「坏尺寸」。  
- 13" 分屏、外接竖屏、演示缩放都必须能落到 min 以下舒适区外的可用区。  
- 与 `FLOOR` shell（480×360）区分：shell 是浮层，窗口 min 应更大。

**为何不是 720：**

- 侧栏默认 300 打开时，720 主内容只剩 ~420，chat+右栏会同时崩；880 在「侧栏开、右栏关」仍可工作。

**配置落点（二选一，优先 A）：**

| 方案 | 做法 | 说明 |
|------|------|------|
| **A（推荐）** | `tauri.conf.json` → `app.windows[0].minWidth/minHeight` | 冷启动即生效，无 race |
| B | 前端 mount 时 `getCurrentWindow().setMinSize(LogicalSize)` | 便于动态，但闪一下；可作补充 |

v1 用 **A**。若后续要按 DPI/平台微调，再在 `WindowLifecycleHost` mount 时 **setMinSize 覆盖**（不得低于 conf）。

### 4.2 L2 — 开右栏软扩窗（调整）

替换过高常量：

| 常量 | 现值 | **新值** | 含义 |
|------|------|----------|------|
| `RIGHT_PANEL_MAIN_TARGET` | 1600 | **1200** | 开栏前希望「主内容组」宽度（window − sidebar）达到的舒适值 |
| `RIGHT_PANEL_SCREEN_MIN` | 1600 | **删掉独立门槛** | 改为：仅当 `desiredWindow ≤ availWidth` 且 `targetWidth > innerWidth+1` 才扩 |

**新算法（伪代码）：**

```
current = mainContentWidth(sidebarOpen, sidebarWidth)
if current >= MAIN_TARGET: return false

sidebarPx = sidebarOpen ? sidebarWidth : 0
desiredWindow = MAIN_TARGET + sidebarPx
// 舒适目标可再加「右栏默认份额」可选：见备注
avail = screen.availWidth
target = max(innerWidth, min(desiredWindow, avail))
if target <= innerWidth + 1: return false   // 屏不够或已够大

setSize(LogicalSize(target, innerHeight))
return true
```

**备注 — 是否把右栏宽度算进 desired：**

- v1：**不算**。目标是「主内容组」宽（含将要出现的右栏），与现语义一致：`mainContentWidth` = group 宽 = 主栏+右栏合计。  
- 开栏后 L3 再把 group 切成主 ≥34% / 右 ≥350px。  
- 因此 `MAIN_TARGET=1200` ≈ 主栏舒适 + 右栏 default ~26% 的合计，而非「仅聊天列 1200」。

**小屏行为：**

| availWidth | 行为 |
|------------|------|
| ≥ desired（如 1500+） | 扩到 desired |
| desired 与 inner 之间 | 扩到 avail（贴满工作区宽，不超屏） |
| ≤ innerWidth | 不扩，直接开栏（L3 挤） |

### 4.3 L3 — 面板布局 min（微调，大体保持）

| 项 | 现值 | 提案 | 说明 |
|----|------|------|------|
| 右栏像素底 | `RIGHT_RAIL_MIN_PX = 280` | **350** | titlebar + 内容更宽裕 |
| 右栏 % | `min(45, max(15, round(350/w*100)))` | **保持公式** | 极窄时上限 45%，给主栏留位 |
| 右栏 default / max | 26% / 65% | **保持** | |
| 主栏 minSize | 34% | **保持 34%** | 与右栏 max 65% 互补（34+65>100 由库协调） |
| 主栏像素底 | 无 | **可选 v1.1**：`MAIN_PANE_MIN_PX = 360`，转 % 与 34 取 max | 仅当实测 34% 在 ~900 窗上仍过窄时再加 |

**不变量：**

```
RIGHT_RAIL_MIN_PX + MAIN_PANE_MIN_PX(若有) + SIDEBAR_WIDTH_MIN
  ≲ WINDOW_MIN_WIDTH
```

用提案数验算（侧栏开 min）：

```
200 (sidebar min) + 360 (main optional) + 350 (rail) = 910 ≳ 880
```

注：optional `MAIN_PANE_MIN_PX` 未落地；侧栏 min + rail = 550 ≤ 880。极窄时 L3 `%` cap(45%) 优先保主栏。

侧栏关、仅主+右（无 main px floor）：

```
350 (rail) + 主栏余量 ≤ 880 ✓
```

### 4.4 高度

| 项 | 提案 |
|----|------|
| 窗口 minH | 560 |
| 开栏扩窗 | **不改高度**（保持现 `innerHeight`） |
| 垂直分栏 | 本 spec 不涉及（Artifact 内 terminal 等仍用各自 minSize） |

---

## 5. 交互与生命周期

### 5.1 冷启动

1. OS 应用 `minWidth/minHeight`。  
2. 恢复上次 frame（若有）时：若低于 min，系统/Tauri clamp 到 min。  
3. 不主动 enlarge 到 `MAIN_TARGET`（仅开右栏触发 L2）。

### 5.2 打开右栏

```
user toggles rail on
  → await widenWindowForRightPanel(...)   // L2，可 no-op
  → panel.expand()                        // L3
```

- 顺序保持现 `AppLayout` effect：先 widen 再 expand。  
- widen 与 expand 之间若 unmount/`cancelled`，不 expand（现有）。

### 5.3 关闭右栏

- **只** `collapse()`；**不** `setSize` 缩窗；**不**改 min。  
- 用户若嫌窗大，自行拖边缘（符合「只增不减」预期）。

### 5.4 用户拖窗口

- 拖到 L1 min 顶住。  
- 右栏开着时拖窄：L3 分割条按 % 压缩，直到双 min；再窄由窗口 min 挡住。  
- **不**在 resize 事件里自动关栏。

### 5.5 最大化 / 全屏

- min 约束在非 max 恢复后仍在。  
- L2 在 max 时：`target <= innerWidth` → no-op（正确）。

### 5.6 多显示器 / 缩放

- 一律 logical px。  
- `availWidth` 取 **当前屏** `window.screen.availWidth`（现有）；不跨屏求和。  
- 外接屏拔掉导致窗超出：交给 OS；下次开栏 L2 再 clamp。

---

## 6. 实现计划

### 6.1 文件改动

| 文件 | 变更 |
|------|------|
| `src-tauri/tauri.conf.json` | `windows[0]` 增加 `minWidth: 880`, `minHeight: 560` |
| `src/lib/windowMinSize.ts` **（新）** | 导出 `WINDOW_MIN_WIDTH/HEIGHT`，供测试与文档单源；可选 runtime assert |
| `src/lib/rightPanelWidth.ts` | `MAIN_TARGET → 1200`；删除/内联 `SCREEN_MIN`；算法按 §4.2 |
| `src/lib/rightPanelWidth.test.ts` | 更新期望；补「avail 介于 inner 与 desired」；补「无 SCREEN_MIN 门槛」 |
| `src/routes/AppLayout.tsx` | 常量可 re-export 自 `windowMinSize` 或保持 `RIGHT_RAIL_MIN_PX` 本地；注释指向本 spec |
| `docs/design/window-min-size-spec.md` | 本文 |

**刻意不改：**

- `WindowLifecycleHost`（v1 无动态 min）  
- `sidebarWidth.ts`  
- capabilities（`setSize` 已有则不动；若 conf-only min 则无需新 perm）

### 6.2 常量单源建议

```ts
// src/lib/windowMinSize.ts
export const WINDOW_MIN_WIDTH = 880
export const WINDOW_MIN_HEIGHT = 560

// src/lib/rightPanelWidth.ts
export const RIGHT_PANEL_MAIN_TARGET = 1200
// RIGHT_PANEL_SCREEN_MIN 删除

// src/routes/AppLayout.tsx
export const RIGHT_RAIL_MIN_PX = 350  // AppLayout 本地；或迁到 rightPanelWidth.ts
```

`tauri.conf.json` 数字与 TS **双写**：conf 不能 import TS。在 `windowMinSize.test.ts` 里读 conf JSON assert 一致（或脚本 check）。推荐最小测试：

```ts
import conf from '../../src-tauri/tauri.conf.json'
expect(conf.app.windows[0].minWidth).toBe(WINDOW_MIN_WIDTH)
expect(conf.app.windows[0].minHeight).toBe(WINDOW_MIN_HEIGHT)
```

### 6.3 测试

| 层级 | 内容 |
|------|------|
| Unit | `rightPanelWidth`：扩/不扩/clamp avail/非 Tauri/失败 |
| Unit | conf ↔ TS min 一致 |
| Unit | `useRailMinPct` 公式（若抽出纯函数）在 w=1000 → 28%，w=500 → 45% cap |
| 真机（可选） | `yarn tauri dev`：拖到 min 顶住；开栏在 1100 宽窗 + 1920 屏应 enlarge；1366 屏应部分 enlarge 或贴 avail |

### 6.4 实现顺序

1. 落 conf min + `windowMinSize.ts` + 一致性测试  
2. 改 L2 常量与算法 + 单测  
3. （可选）抽出 `railMinPct(w)` 纯函数  
4. 真机点验 5 分钟  
5. 若主栏在 880 仍难受 → 加 `MAIN_PANE_MIN_PX`

---

## 7. Phase 2（明确不做，仅备案）

| 项 | 说明 | 风险 |
|----|------|------|
| 关栏还原宽度 | 记住 open 前 `innerWidth`，collapse 时缩回 | 用户中途手拖过大则难判；易抖动 |
| 开栏动态 `setMinSize(更大)` | 开栏抬 min，关栏降回 | P3；分屏痛苦 |
| 按 surface 不同 MAIN_TARGET | Code 要更宽、KB outline 可窄 | 复杂度高，先统一 1200 |
| 记住右栏 % | `react-resizable-panels` autoSaveId | 独立 feature |

---

## 8. 验收标准

- [x] 主窗口无法拖到小于 **880×560**（logical）。  
- [x] 右栏打开后拖分割条，右栏宽度 ≥ **350px**（在 group 足够宽时）；group 极窄时 % cap 仍给主栏 ≥ ~55% 量级。  
- [x] 窗宽 1000、侧栏 300、屏 1920：开右栏 → 窗 enlarge 到约 **1500**（1200+300），再 expand。  
- [x] 窗宽 1000、屏 1366：开右栏 → enlarge 到 ≤1366，不报错，栏仍打开。  
- [x] 窗宽已 ≥ 目标：开右栏 **不**调用 `setSize`。  
- [x] 关右栏：**不**自动改窗宽。  
- [x] 浏览器/非 Tauri dev：widen no-op，栏仍可开（现有）。  
- [x] 单测全绿；conf 与 TS min 一致。

---

## 9. 决策记录（ADR 摘要）

| 决策 | 选择 | 否决 |
|------|------|------|
| D1 窗口 min 量级 | 宽松 880×560 | 与 default 同级的 1600 min |
| D2 开/关两套 min | 否，单套 L1 | 开栏抬 min |
| D3 开栏扩窗目标 | 主内容组 1200 | 保持 1600 |
| D4 屏不够 | 仍开栏，能扩多少扩多少 | 禁止开栏 / 静默 fail 且不扩 |
| D5 关栏 | 不缩窗 | 自动还原 |
| D6 min 配置 | conf 静态 | 仅 runtime setMinSize |

---

## 10. 开放问题

1. **880 是否在 Windows 缩放 150% 下仍舒适？** 实现后用 125%/150% 各拖一次；若偏紧改为 920。  
2. **是否需要 `MAIN_PANE_MIN_PX`？** 先靠 34% + 窗口 min 观察一周。  
3. **default 启动 1600×1100 是否同步降到 1280×800？** 本 spec 不改；可另开 issue（首次安装小屏体验）。

---

## 附录 A — 与现码对照

| 位置 | 现行为 | Spec 后 |
|------|--------|---------|
| `tauri.conf.json` windows[0] | width/height only | +minWidth/minHeight |
| `RIGHT_PANEL_MAIN_TARGET` | 1600 | 1200 |
| `RIGHT_PANEL_SCREEN_MIN` | 1600 硬门槛 | 删除；用 avail clamp |
| `RIGHT_RAIL_MIN_PX` | 280 | 350 |
| Main `Panel minSize` | 34 | 34 |
| 关栏 | collapse only | 同左 |

## 附录 B — 用户可见文案

无新增 UI 文案。无需 i18n。
