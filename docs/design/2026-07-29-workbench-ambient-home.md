# hip 工作台 · Ambient Calm Home（推翻卡通农场）

| 字段 | 值 |
|------|-----|
| **Title** | Workbench Ambient Calm Home |
| **Date** | 2026-07-29 |
| **Status** | **Implemented** |
| **Supersedes** | `2026-07-29-workbench-farm-sky.md`（农场远景 SVG）、`IsoFarmMap` 作为冷启动主界面 |
| **References** | Linear, Raycast, Stripe mesh / Apple aurora, Craft, Awwwards gradient craft |

---

## 1. Why overturn

卡通山丘 / 太阳 / 云 / 菜畦远景在 **桌面 AI 工作台** 语境下观感廉价，与 hip 中性 chrome + 暖橙品牌冲突，也与既有 Calm Home spec（`2026-07-29-workbench-command-deck.md`）矛盾。

## 2. Case study takeaways

| 产品 / 方向 | 背景做法 | 可借原则 |
|-------------|----------|----------|
| **Linear** | 近黑/近白 canvas，极轻环境光，内容即 UI | 背景不叙事；信息层级靠列表与字重 |
| **Raycast** | 空态 = 极简 + 焦点搜索，几乎无插画 | 首页是工具入口，不是场景 |
| **Stripe / mesh gradient** | 大面积 soft blob 色场，高度模糊 | 氛围用 mesh，不用具象风景 |
| **Apple aurora** | 大半径色晕、低饱和、慢漂移 | 动效几乎察觉不到 |
| **Craft / Notion home** | 文档感中栏，干净底 | 编辑向列宽 + 克制装饰 |
| **Awwwards 梯度趋势** | 多色 blob + blur，忌硬边插画 | 软边、低对比、服务内容可读 |

**结论**：工作台背景 = **Ambient Mesh（氛围色场）**，不是世界场景。

## 3. Product decision

```
WorkbenchPage
└── HomeShell                    ← 主界面（Linear 式列表）
    ├── AmbientBackdrop          ← mesh 色场 only
    ├── HomeHeader
    ├── SurfaceRow × N
    └── QuickStart
```

- **不再**以 `IsoFarmMap` / `FarmSky` 为冷启动主路径（代码可保留，不挂主路由）。
- **不再**挂载 Three `CosmosHost` 作为默认背景。
- 文案去农场化（eyebrow / surfaces / hero sub）。

## 4. AmbientBackdrop visual rules

1. 仅 hip tokens：`--bg-app`、`--accent`、中性冷色；饱和度极低。
2. 3–4 个 radial mesh blob + 可选极轻 grain；`pointer-events: none`。
3. Light：白底 + 暖橙 4–8% + 冷 slate 微晕。Dark：深底 + indigo / 橙 低透光斑。
4. `workbenchReduceMotion` / `prefers-reduced-motion`：冻结 blob 漂移。
5. 列表区 frosted 卡片保证对比；背景永远退后。

## 5. Non-goals

- 具象山 / 树 / 太阳 / 田地 / 像素农场
- 默认 3D / 粒子剧场
- 照片壁纸

## 6. Content density (v2 — case-driven)

优秀产品首页密度模式（Notion Home / Linear triage / Cursor recents）：

| 区块 | 参考 | 数据源 |
|------|------|--------|
| Hero + metrics | Linear overview | `aggregateHero` |
| **Continue** | Notion / Cursor resume | 最近 `session` |
| **Needs attention** | Linear triage | zone `fail` / `blocked` |
| Surfaces list | Linear rows | `buildZoneModels` |
| **Quick start cards** | Raycast / Arc launchers | feature-flagged actions |
| **Recent sessions** | Cursor / Notion recent | top N sessions |

信息架构：

```
HomeShell
├── AmbientBackdrop
├── HomeHeader
├── ContinueWork
├── NeedsAttention   (conditional)
├── Surfaces (SurfaceRow × N)
├── QuickStart       (icon cards)
└── RecentSessions
```

## 7. Acceptance

1. 冷启动 = Calm Home 列表，无农场地图 testid。
2. 背景为 ambient mesh，无 SVG 山脊。
3. 有 Continue / Surfaces / Quick start / Recent 四类内容（Attention 有数据时出现）。
4. workbench 单测绿。
