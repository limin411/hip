# Hip 菜单图标系统升级 —— 方案 C（Warm Bold · 醒目圆端 + 选中填充 + 状态徽标）

> 配套视觉预览：`docs/examples/icon-preview-C.html`（浏览器直接打开；展示 active 品牌橙填充、状态徽标、slash 变体）。
> 方案 A：`docs/icon-system-spec.md`（24px · 1.75 圆端 · 品牌位双色）／方案 B：`docs/icon-system-spec-B.md`（16px 原生 · 1.5 硬端 · 中性填充态）。
> 本方案为**第三备选**，三案并列选一，不混用。

## 1. 案例研究（本方案的设计依据）

- **Raycast（2022 图标体系，James McDonald 设计）**：与 hip 同类的"温暖实用型"开发工具。核心手法 —— outline 线条 + **加粗描边**（"bolder stroke width to make them more prominent"），统一描边宽与圆角半径规则，让图标集"可辨识、有个性、经久不衰"。品牌红 `#FF6363` 只做**标点**，不铺满。
- **Apple SF Symbols**：四种渲染模式（monochrome / **hierarchical** / palette / multicolor）+ 设计变体（**fill / slash / enclosed**）。明确规则："**fill 变体用于选择**——iOS tab bar 用 fill + accent 色表达选中"。即：选中态 = 实色填充 + 品牌色。
- **Microsoft Fluent 2**：Regular / **Filled 双主题**，"Filled 用于高亮选中态"；**modifier 修饰符**统一放在图标**右下角**表达附加语义；多尺寸（12/16/20/24/28/48）**逐档重绘**而非缩放。
- **Vercel（deployment 状态）**：把**状态直接做进图标**（构建中 spinner / 就绪 ✓ / 失败 ✕），不用切换视图就能感知状态。
- **Apple HIG（App Icons）**：图标应表达产品个性与本质；hip 的个性就是 Flat Butt 暖橙吉祥物 —— 这是 C 方案把品牌橙用于 active 的底气。

## 2. 方案 C 是什么

一句话：**加粗圆端的"友好线框" + 选中即品牌橙实底 + 右下角状态徽标。**

与 A/B 的根本分歧：

| 维度 | A（工具线框） | B（像素极简） | C（本方案） |
|---|---|---|---|
| 源网格 | 24×24 | 16×16 原生 | **24×24** |
| 描边 | 1.75px round | 1.5px square | **2.0px round（醒目）** |
| 形状圆角 | 2px | 1px | **3px（友好感）** |
| active 态 | 底色 + 可选双色 | 中性色实底填充 | **品牌橙实底填充**（选中 = 品牌时刻） |
| 状态表达 | 无 | 无 | **右下角状态徽标**（Fluent modifier 法） |
| 变体体系 | — | `-filled` | **`-filled` / `-slash` / `-enclosed`**（SF Symbols 法） |
| 气质 | 工具化安静 | 冷峻工程师 | **温暖友好（与 Flat Butt 吉祥物同频）** |

三案气质光谱：**A 安静工具 · B 冷峻极客 · C 温暖可靠**。C 是唯一让品牌色进入菜单常态交互的方案，也是唯一把"运行状态"做进侧栏的方案 —— 对 hip 这种"AI 工作台"（会话/终端/自动化持续运行）最贴切。

## 3. 规范

### 3.1 网格与描边

- 设计网格 **24×24**（与 A 同源，lucide 可直接对照替换）；主体 ≤22×22。
- 描边 **2.0px 恒定**（Raycast"bolder stroke"思路：粗 = 可辨识、菜单 16px 下依然醒目）。
- 终端 **round**、join **round**；形状外角 **3px**（比 A 的 2px 更圆润友好，呼应吉祥物曲线）。
- 关键坐标 0.5 步进（与 A 一致）。

### 3.2 状态（C 的核心差异）

| 状态 | 行为 |
|---|---|
| 常态 | 线条 `currentColor`（比文字深一档） |
| hover | 底色 `--state-hover` |
| **active** | **图标实底填充 `--accent`**（亮 `#c2410c` / 暗 `#ffb300`）+ `--on-accent` 掏空细节 + 底色 `--state-active`；**选中即品牌时刻** |
| focus | 2px accent 方形 ring（沿用全局） |
| 禁用 | `opacity-40` + 可选 `-slash` 变体 |

> 与 DESIGN.md 的关系：DESIGN.md 说"侧栏 active 无 accent 左条"，C 不破坏它 —— 不用左条，而是**图标本身**变品牌色。这是"暖橙唯一强调色"原则的延续而非违背。

### 3.3 状态徽标（Status Modifier）

Fluent 法：修饰符统一放**右下角**，4px 实心圆，带 1px 描边环（白/深色描边保证任何底色可辨）。

| 徽标 | 颜色 | 语义 |
|---|---|---|
| ● 绿 | `--success` | 运行中 / 已连接 |
| ● 琥珀 | `--warning` | 排队 / 有动作待批 |
| ● 红 | `--danger` | 失败 / 出错 |
| ● 灰 | `--text-tertiary` | 空闲 / 已停止 |

示例：终端行右下绿点 = 有活动 SSH 会话；自动化行琥珀点 = 有任务在跑。侧栏即仪表。

### 3.4 变体体系（SF Symbols 法）

| 变体 | 用途 |
|---|---|
| `hip-*-filled` | active 选中态（品牌橙实底） |
| `hip-*-slash` | 功能未启用 / 禁用（如语音未配置时） |
| `hip-*-enclosed` | 圆角方块底板（20px），托盘 / 工具栏 / 空状态用 |

### 3.5 尺寸档

| 档位 | 尺寸 | 说明 |
|---|---|---|
| `--icon-sm` | 16px | 菜单标准（24 源图缩放，与 A 相同） |
| `--icon-md` | **20px 重绘档** | 工具栏 / 托盘（Fluent 多尺寸思想：关键档重绘不缩放） |
| `--icon-lg` | 24px | 空状态 |
| `--icon-hero` | 40–64px | 品牌位（enclosed 底板 + 吉祥物） |

### 3.6 明暗

- 亮色：active 橙 `#c2410c` 底 + `#fff` 细节；暗色：`#ffb300` 底 + `#111` 细节（沿用 DESIGN.md 暗色反转逻辑）。
- 徽标色沿用状态 token，亮暗自动适配。

## 4. 图标总表（lucide → hip-C）

与 A 同一套 24px 图形语言（气泡/书本/闪电等造型一致，避免三案重复设计工作），差异在：**3px 圆角 + 2px 粗描边 + filled/slash/enclosed 变体 + 状态徽标**。

### A. 主侧栏导航（6，全部含 `-filled` 变体）

| 新名 | 语义 | 备注 |
|---|---|---|
| `hip-sessions` | 会话 | 3px 圆角气泡 + 三点；filled 时三点用 `--on-accent` 掏空 |
| `hip-projects` | 项目 | `</>` + 中缝斜杠；filled 为三块实心多边形 |
| `hip-knowledge` | 知识库 | 摊开书 + 脊线 |
| `hip-terminal` | 终端 | 3px 圆角窗口 + `>_`；**可挂状态徽标** |
| `hip-tasks` | 任务 | 勾选框 + 条目线；filled 时勾用 `--on-accent` 掏空 |
| `hip-automation` | 自动化 | 闪电；**可挂状态徽标** |

### B. 侧栏 footer（3）

`hip-trash` / `hip-history` / `hip-settings`（8 齿齿轮）—— 图形同 A，加粗 + 3px 圆角。

### C. 设置导航（11）与右键（9）

图形同 A 的方案集（general/voice/window/model/connectors/memory/agents/mcp/skill/plugins/hooks + plus/sun/moon/monitor/palette/keyboard/wrench/branch/puzzle）。差异项：

- `hip-voice` 提供 **`-slash` 变体**（未启用语音时用）；
- 右键菜单 14px 档：2px 粗描边在 14px 有效 1.17px，可辨性优于 A 的 1.75（1.02px）。

### D. 状态与通用（14+）

`hip-check` / `circleCheck` / `circleX` / `alert` / `info` / `ban` / `loader` / `target` / `search` / `folder` / `pencil` / `copy` / `download` / `external` / `eye` / `lock` / `mic` / `micOff` / `server` / `users` / `key` / `shield` / `calendar` / `chevron-*` / `ellipsis` —— 按 §3 规范绘制。

### E. 新增（C 独有）

| 新名 | 用途 |
|---|---|
| `hip-enclosed-*` | 托盘/工具栏底板图标（20px 圆角方块，`--bg-muted` 底或 `--accent` 底） |
| `hip-dot-*`（状态徽标） | 右下角 4px 圆，四色语义（§3.3），作为 modifier 叠加到任何图标 |

## 5. 迁移计划（沿用 A 的分阶段结构，加两处工程增强）

- **P1** 基础设施：`hip-icons-c.ts` + `HipIcon`（props：`name / size / variant: line|filled|slash|enclosed / status?: dot color / duo`）+ `--icon-*` token。
- **P2** 主入口 9 图标（含 filled 与徽标示例）。
- **P3** 全量菜单（设置 11 + 右键 23 + 命令面板）+ slash 变体接入（语音未配置态）。
- **P4** 收尾：enclosed 托盘图标、20px 重绘档、移除 lucide。
- 每阶段单 commit 可回滚；`HipIcon` 与 lucide 并存期与 A 相同。

## 6. 三案决策速查

| 决策点 | A | B | C |
|---|---|---|---|
| 品牌识别度（菜单内） | 弱（双色仅品牌位） | 无 | **强（active 即品牌橙）** |
| 与 DESIGN.md 直角语言 | 圆端略冲突 | 完全一致 | **圆端 3px（暖化）** |
| 状态可见性（侧栏） | 无 | 无 | **徽标（运行/排队/错误）** |
| 像素清晰度 | 0.5 步进 | **原生像素** | 同 A |
| 可辨识度（14px 右键） | 中 | 中 | **高（2px 粗描边）** |
| 工程复杂度 | 中 | 中（双份图形） | **中高（三变体 + 徽标）** |
| 气质 | 安静工具 | 冷峻极客 | **温暖可靠（吉祥物同频）** |

**适用判断**：想要"专业工具感、不抢戏" → A；想要"极致极客、像素完美" → B；想要"一眼认出是 hip、状态尽收眼底" → C。

## 7. 验收清单（C 专属）

1. [ ] active 品牌橙填充在亮（#c2410c/白）暗（#ffb300/#111）两主题均达 AA
2. [ ] 6 个主导航 `-filled` 变体与线条变体 1:1 同构
3. [ ] 状态徽标 4px 圆在侧栏任何底色（hover/active/普通）均可辨（1px 描边环生效）
4. [ ] `-slash` 变体斜线与原图形关系清晰（不误读为删除）
5. [ ] `-enclosed` 20px 档与 16px 菜单档视觉重量一致
6. [ ] 右键 14px 档粗描边无糊线（2× 放大核对）
7. [ ] 徽标与 `prefers-reduced-motion` 无冲突（徽标静态，不闪烁）
8. [ ] 全库菜单图标无 lucide 残留（grep 验收）

## 8. 相关文件

| 文件 | 内容 |
|---|---|
| `docs/icon-system-spec-C.md` | 本文档 |
| `docs/examples/icon-preview-C.html` | 视觉预览（品牌橙 active、状态徽标、slash/enclosed 变体） |
| `docs/examples/icon-data.js` | lucide 现状路径（与 A/B 共用） |
| `docs/icon-system-spec.md` / `icon-preview.html` | 方案 A |
| `docs/icon-system-spec-B.md` / `icon-preview-B.html` | 方案 B |
