# Hip 菜单图标系统升级 —— 方案 B（Pixel-Sharp · 工程师像素风）

> 配套视觉预览：`docs/examples/icon-preview-B.html`（浏览器直接打开；可切换亮/暗、尺寸、描边，展示 active 填充态）。
> 方案 A：`docs/icon-system-spec.md` + `docs/examples/icon-preview.html`（24px 源图 · 1.75px 圆端 · 双色）。
> 本方案为**并列备选**，与 A 二选一，不混用。
>
> **案例研究（先看）**：本方案的设计依据来自以下公开案例 ——
> - **Atlassian Design（2025.9）**「Reinventing our iconography system at scale」：legacy 2px/24px 太重 → 重绘为 1.5px/16px 核心集，笔画对齐像素网格；12px 降采样版供标签/元数据；单用途/多用途分类法；16,000 处调用点迁移，靠 ESLint 规则自动修复约 75% + Icon Facade 运行时替换 + SVG 扫描截图审计。
> - **Vercel Geist**（Glenn Hitchcock 执笔）：图标全部在 **16×16 原生设计**、1.5pt 描边、hard caps（硬终端）、全组一致角度 —— Swiss 几何原则，"比大多数图标更锋利"。
> - **GitHub Primer**：16px 与 24px 双网格版本、1.5px 恒定描边、1px 外角圆角、参考形（reference shapes）保证光学体积一致、0.25px 填充细节。
> - **Material Design**：2dp 恒定描边、**方形描边终端**、2dp 外角圆角、keyline（圆/方/对角）统一构图。
> - **Linear（2024）**：侧栏图标/标签/按钮垂直水平对齐是"用几分钟才能感觉到"的细节；中性图标亮色模式更黑、暗色模式更白。
> - **Kendo/Phosphor duotone** 等：三变体（outline/solid/duotone）系统 —— 本方案**刻意不采用** duotone，理由见 §2。

## 1. 方案 B 是什么

一句话：**放弃 24px 源图，直接在 16px 像素网格上设计一套"工程师锐利风"图标；菜单 active 态由底色升级为图标实底填充。**

与方案 A 的三个根本分歧：

| 维度 | 方案 A | 方案 B（本方案） |
|---|---|---|
| 源网格 | 24×24，渲染时缩到 16 | **16×16 原生设计**，像素级对齐 |
| 描边 | 1.75px，round 圆端 | **1.5px，square 硬终端** |
| 外角圆角 | 2px | **1px** |
| 状态表达 | 底色变化 + 可选双色层 | **active = 图标填充实底**（fill variant） |
| 品牌色入图标 | 暖橙双色层（品牌位） | **不入色**；品牌靠填充态与吉祥物 |
| 双色 duotone | 支持 | **不支持**（显式拒绝） |

## 2. 为什么选这条路线（论证）

1. **Atlassian 证明 2px/24px 太重**。他们的 legacy 系统与 hip 现状几乎同构（lucide 2px/24px）：设计师被迫给图标用更浅的灰来"压视觉"。改 1.5px/16px 后图标与正文笔画和谐。hip 的 DESIGN.md 本身就是"克制、工具化"，1.5px 与此同频。
2. **硬终端与 DESIGN.md 的"直角优先 Sharp over Round"一致**。方案 A 的 round cap 其实与扁平化直角语言轻微冲突（圆的端头更像消费级）。Geist 用 hard caps 做出"更锋利"的开发者感；Material 也规定方形终端。
3. **16px 原生 = 亚像素问题消失**。24 源图缩 16 时 0.5 步进坐标会产生亚像素模糊；16px 原生设计让垂直/水平描边精确落像素（Atlassian 专门强调了这一点，他们为低分辨率屏最大化清晰度）。
4. **active 填充态在 16px 下比底色更可辨**（Linear/Vercel dashboard 实践）。侧栏行 34px 高，底色 `--state-active` 与 hover 只差一档灰，接近时难区分；图标填充后层级一目了然，且不需要引入任何颜色。
5. **拒绝 duotone**：Kendo/Phosphor 的 duotone 依赖 20% 透明度背景层，与 hip"固体优先、禁止半透明"的 DESIGN.md 直接冲突。方案 A 的双色是实色填充（可接受），但 B 认为 16px 下双色信息密度过低，不如填充态直接。

## 3. 规范（与 A 完全不同的实现细则）

### 3.1 网格与像素

- **设计网格 16×16，绘制即最终尺寸**；不再有 24 源图。
- 内容区 14×14（留 1px 光学边距）；特殊宽/高图标可顶到 15。
- 垂直/水平描边**对齐整像素**（线中心落在整数坐标，1.5px 描边两侧各 0.75 → 覆盖 1 整像素 + 相邻半像素，清晰无糊）；45° 线对齐 0.5 步进。
- 参考形（Primer 法）：圆 r5.5、方 11×11、对角线长 12 —— 所有图标以这三种"光学体积"为基准布线，保证视觉一致。

### 3.2 描边与圆角

| 项 | 值 | 来源 |
|---|---|---|
| 描边宽 | **1.5px 恒定**（16 与 24 相同） | Primer / Atlassian / Geist |
| 终端 cap | **square（硬终端）** | Material / Geist |
| 连接 join | round（避免尖角挂刺） | — |
| 外角圆角 | **1px** | Primer |
| 填充细节 | ≥0.25px 圆角 | Primer |

### 3.3 双网格与尺寸档

| 档位 | 尺寸 | 来源 |
|---|---|---|
| `--icon-tag` | **12px 降采样**（标签/元数据内） | Atlassian：16 核心集直接降采样 |
| `--icon-sm` | **16px 核心档**（菜单标准） | Atlassian / Geist 核心 |
| `--icon-lg` | **24px 放大版**（空状态，同图形 1:1.5 放大，不重画） | Primer 双网格 |

> 与 A 不同：B **不设 20px 工具栏档**（工具栏 = 16px；无 18/20 散点）；**不设 40–64 品牌位**（品牌位由吉祥物 Logo 承担，图标不进场）。

### 3.4 状态（B 的核心差异）

| 状态 | 行为 |
|---|---|
| 常态 | 线条，`currentColor` |
| hover | 底色 `--state-hover` |
| **active** | **图标填充实底**（fill variant）+ 底色 `--state-active`；填充缺口（气泡点、勾、齿轮孔）用底色掏空 |
| focus | 2px accent 方形 ring（沿用全局） |
| 禁用 | `opacity-40` |

填充变体命名 `hip-chat-filled`（Siemens 同款 `-filled` 后缀惯例）。16px 下填充形比线条形重一档，正好承担"当前所在"的语义。

### 3.5 分类法（Atlassian 法）

- **单用途图标**：按语义命名（`hip-sessions`、`hip-tasks`、`hip-automation`），全库唯一用法。
- **多用途图标**：按图形命名（`hip-chevron-right`、`hip-search`），允许跨上下文复用。
- 新增图标走审核路径：先查分类法 → 单用途归语义、多用途归图形，禁止同一个图形两种语义。

### 3.6 明暗对比（Linear 法）

- 亮色模式：图标比文字深一档（`--text-secondary` 级）；暗色模式：图标比文字浅一档。
- 不引入图标专属颜色 token，图标永远 `currentColor`，与行文字联动。

## 4. 图标总表（lucide → hip-B）

### A. 主侧栏导航（6，全部重绘 + 填充变体）

| 新名 | 语义 | 设计要点（16px 原生） |
|---|---|---|
| `hip-sessions` | 会话 | 气泡圆角 1px、三点 r1 实心、尾线左出 |
| `hip-projects` | 项目 | `</>` 硬角斜线，45° 精确对齐 0.5 网格 |
| `hip-knowledge` | 知识库 | 摊开书 + 中缝，弧用参考圆 r3.2 |
| `hip-terminal` | 终端 | 窗口 1px 圆角 + 左对齐 `>_` |
| `hip-tasks` | 任务 | 勾选框 4×4 + 条目线，勾为 45° 双折线 |
| `hip-automation` | 自动化 | 闪电，多边形角全硬角 |

### B. 侧栏 footer（3）

| 新名 | 语义 | 设计要点 |
|---|---|---|
| `hip-trash` | 回收站 | 桶盖微翘，硬角多边形 |
| `hip-history` | 历史 | 圆 r5.5 + 指针 + 左上回退箭头（lucide 同构几何缩 16） |
| `hip-settings` | 设置 | **6 齿齿轮**（16px 放不下 8 齿；程序化生成，齿根/齿顶双半径） |

### C. 设置导航（11）

`hip-general`（三滑杆）、`hip-voice`（胶囊麦）、`hip-window`（窗口+灯点）、`hip-model`（芯片+引脚）、`hip-connectors`（线缆）、`hip-memory`（双脑叶）、`hip-agents`（方头 bot）、`hip-mcp`（插头）、`hip-skill`（四角星）、`hip-plugins`（立方体）、`hip-hooks`（双链环）—— 全部沿用成熟造型按 B 规范重绘，不列逐条。

### D. 状态与通用（14 个）

`hip-check`、`hip-circle-check/x/alert/info/ban/loader/target`、`hip-search`、`hip-folder`、`hip-pencil`、`hip-copy`、`hip-download`、`hip-external`、`hip-eye`、`hip-lock`、`hip-mic/mic-off`、`hip-server`、`hip-users`、`hip-key`、`hip-shield`、`hip-calendar`、`hip-chevron-*`、`hip-ellipsis` —— 按 §3 规范统一重绘。

## 5. 迁移与工具链（借鉴 Atlassian，方案 B 的工程化卖点）

A 的迁移计划是"手工映射表 + 分阶段替换"；B 直接抄 Atlassian 的成熟作业：

1. **ESLint 规则 + 自动修复**：写 `hip-icon-migration` 规则，内置旧→新映射表（覆盖本 spec §4 全部条目），`--fix` 自动改写 import 与调用；预期自动修复率 ≈75%（Atlassian 实测）。
2. **Icon Facade（运行时替换）**：一个 `lucide-to-hip` 包装组件，`<MessageSquare/>` 在运行时渲染成 `hip-sessions`，无需改调用点即可全 app 预览新图标 —— 评审阶段直接"换皮看效果"。
3. **SVG 扫描审计**：脚本扫全库 `<svg>`/icon 调用点，截图生成人工复核文档（Atlassian 做法，Confluence 用此审计自定义图标）。
4. **Feature flag + 向后兼容 props**：`HipIcon` 组件接受 `legacy` prop 兜底，新旧可随时切回。
5. **分阶段**：P1 工具链（ESLint 规则 + Facade + `hip-icons-16` 数据包）→ P2 主入口 9 图标 → P3 全量菜单 → P4 移除 lucide 依赖。每阶段单 commit 可回滚。

## 6. 方案 A / B 决策速查

| 决策点 | A（24px·圆端·双色） | B（16px·硬端·填充态） |
|---|---|---|
| 与 DESIGN.md 直角语言 | 圆端略冲突 | **完全一致** |
| 像素清晰度（16px 渲染） | 0.5 步进有亚像素风险 | **原生像素对齐** |
| 品牌感 | 暖橙双色层 | 吉祥物承担品牌，图标纯中性 |
| 状态表达 | 底色（弱） | **填充态（强）** |
| 空状态大图 | 图标 40–64px | 吉祥物/填充图标 24px |
| 工作量大 | ~50 个 24px 源图 | ~45 个 16px 源图（更小更快） |
| 工程化 | 手工映射 | **ESLint 自动迁移 + Facade** |
| 风险 | 双色规则执行成本 | 填充态需维护双份图形 |

## 7. 验收清单（B 专属）

1. [ ] 全部图标 16px 下垂直/水平描边无亚像素模糊（截图 2× 放大核对）
2. [ ] 6 个主导航 + 设置 gear 填充变体与线条变体 1:1 同构（图形一致，仅实底/掏空差异）
3. [ ] active 填充态在亮/暗两主题下对比均清晰（与 hover 底色可区分）
4. [ ] 12px 降采样后 1px 圆角细节仍可辨（标签场景）
5. [ ] ESLint 规则对现有 lucide 调用点自动修复率 ≥70%（实测记录）
6. [ ] Icon Facade 开/关两态截图对比，无图标错位（对齐/重心）
7. [ ] 中性图标明暗对比（Linear 法）在两种主题下均满足文字层级
8. [ ] 全库菜单图标无 lucide 残留（grep 验收）

## 8. 相关文件

| 文件 | 内容 |
|---|---|
| `docs/icon-system-spec-B.md` | 本文档 |
| `docs/examples/icon-preview-B.html` | 视觉预览（B 图标集 + 像素网格 + 填充态演示） |
| `docs/examples/icon-data.js` | lucide 现状路径（与 A 共用，仅预览） |
| `docs/icon-system-spec.md` / `icon-preview.html` | 方案 A（并列对照，不删除） |
