# hip 工作台 · 精致农场远景（Farm Sky）Spec & Plan

| 字段 | 值 |
|------|-----|
| **Title** | Workbench Farm Sky — layered illustrated backdrop |
| **Author** | hip design (agent-assisted) |
| **Date** | 2026-07-29 |
| **Status** | **Superseded** by [`2026-07-29-workbench-ambient-home.md`](./2026-07-29-workbench-ambient-home.md) — farm scenic sky abandoned |
| **Audience** | Engineers working on `src/components/workbench/map/` |
| **Related** | Farm map live on workbench; supersedes CSS geometric sky only (not plot/HUD logic) |

---

## 1. Overview

工作台主区是 **2.5D 农场地图**（`IsoFarmMap`）：玻璃 HUD + iso 菜畦 + Flat Butt 农夫。背景原先用纯 CSS 几何（三角山、圆角云、圆点野花）拼成，观感偏原型。

本 Spec 将 **天空 / 远景层** 升级为 **定制分层插画**（内联 SVG + CSS 变量），目标是「金色午后的山间菜畦」：软边、大气透视、双主题可用，且 **不抢** HUD 与地块可读性。

**一句话**：只换远景舞台布景，不重做菜畦与业务。

---

## 2. Goals & Non-Goals

### Goals

1. 用 6 语义层替换简陋 CSS 山/云/篱笆/野花。
2. 自绘（内联）SVG：`mountains` + `ridge`；太阳/云用 SVG 节点 + CSS 动画。
3. light / dark 各成一套色温（CSS 变量驱动 SVG `fill`），禁止整页 `brightness()` 硬压。
4. 保留 `workbenchReduceMotion` / `data-motion=static`：无位移动画。
5. 可选 Phase 3：`data-hero-state` 微色温（首版实现轻量版）。
6. 删除土路 / 篱笆 / 野花装饰层（近景只留干净草地 + 既有 `iso-ground`）。
7. 测试：`WorkbenchPage` 既有挂载用例通过；天空带 `data-testid="workbench-farm-sky"`。

### Non-Goals

- 照片壁纸、像素整图、Kenney 直接贴包
- 重做 `IsoPlot` / mascot / zone 业务
- Three.js / Cosmos 与 farm 混用
- 复杂天气、四季、可滚动大世界
- 新增 npm 依赖

---

## 3. Layer architecture

```
z↑  HUD / plots (unchanged)
│   L6  vignette
│   L5  meadow (soft gradient only)
│   L4  ridge SVG (hills + trees)
│   L3  mountains SVG (far silhouettes)
│   L2  atmosphere (sun + clouds)
│   L1  sky gradient (CSS only)
└──
```

| Layer | DOM / asset | Motion (live) |
|-------|-------------|----------------|
| L1 | `.farm-sky-gradient` | none |
| L2 | sun + 3 cloud groups | clouds: slow translateX; sun: optional weak pulse |
| L3 | `MountainsSvg` | none |
| L4 | `RidgeSvg` | none |
| L5 | `.farm-meadow` | none |
| L6 | `.farm-vignet` | none |

### Removed from previous CSS sky

- CSS triangle mountains (`.iso-sky-mountains`)
- CSS blob clouds / birds / wildflowers / fence / dirt path / meadow-texture dots
- Separate `.iso-sky-haze` (folded into L1 stops)

---

## 4. Visual tokens

Extended on `.iso-farm` (light defaults; `.dark .iso-farm` overrides):

| Token | Light (intent) | Dark (intent) |
|-------|----------------|---------------|
| `--iso-sky-top` | soft blue | deep night blue |
| `--iso-sky-mid` | pale cyan | cooler mid |
| `--iso-sky-bot` | warm horizon | warm dusk / soil night |
| `--farm-mountain-far` | blue-grey | dim slate |
| `--farm-mountain-near` | slightly greener grey | darker slate |
| `--farm-ridge` / `--farm-ridge-deep` | grass family | deep grass |
| `--farm-tree` | deep green | near-black green |
| `--farm-sun-core` / `--farm-sun-glow` | warm disc | soft moon/amber |
| `--farm-cloud` | warm white | cool translucent |

Hero state (subtle): `.iso-farm[data-hero-state=…]` adjusts saturation/sky mix only via CSS vars — no alternate SVG packs.

---

## 5. Assets

| Asset | Form | Notes |
|-------|------|-------|
| Mountains | React inline SVG | `viewBox="0 0 1440 400"`, soft multi-ridge paths |
| Ridge | React inline SVG | hills + simple tree clusters |
| Sun / clouds | SVG in atmosphere div | stylable, animatable as groups |
| CREDITS | N/A | original hip artwork (no third-party pack) |

Volume: path count kept modest (< ~40 paths total). No embedded rasters.

File layout:

```
src/components/workbench/map/
  FarmSky.tsx          # L1–L6 + SVG components
  IsoFarmMap.tsx       # uses <FarmSky />
  isoFarm.css          # sky section rewritten; plot/HUD kept
```

Optional future: extract SVG strings to `public/workbench/farm/` if design handoff needs static files — not required for v1.

---

## 6. Component contract

```tsx
export function FarmSky(props: {
  motion: 'live' | 'static'
}): JSX.Element
```

- `aria-hidden` on root
- `data-testid="workbench-farm-sky"`
- `data-motion={motion}` for CSS animation gates
- Parent `.iso-farm` still owns `data-hero-state` and theme class via app `dark`

`IsoFarmMap` replaces the large sky DOM block with:

```tsx
<FarmSky motion={motion} />
```

---

## 7. A11y & performance

- Sky is decorative (`aria-hidden`); no focusables
- `pointer-events: none` on sky root
- Prefer CSS transforms for cloud motion (compositor-friendly)
- No `filter: blur` stacks on large full-bleed layers
- Respect `data-motion="static"` and existing reduce-motion store flag

---

## 8. Plan (execution order)

| Step | Work | Done when | Status |
|------|------|-----------|--------|
| **P0** | This doc (spec + plan) | File lands in `docs/design/` | ✅ |
| **P1** | `FarmSky.tsx` + SVG layers | Renders 6 layers; testid present | ✅ |
| **P2** | Rewrite sky CSS tokens / remove dead rules | No old mountain/cloud/flower/fence/path selectors left | ✅ |
| **P3** | Wire `IsoFarmMap` | Visual + unit tests pass | ✅ |
| **P4** | Hero-state micro tint + HUD/vignette polish | CSS only | ✅ |
| **P5** | Verify: workbench vitest suite | Green | ✅ |

### Decisions locked

| # | Decision |
|---|----------|
| A | Assets generated in-repo (inline SVG by agent) |
| B | Clouds: slow live motion; static when reduce-motion |
| C | Hero-state: light CSS tint in same PR |
| D | Path / fence / wildflowers: **removed** |

---

## 9. Acceptance criteria

1. Workbench farm map shows soft illustrated mountains + ridge, not CSS triangle peaks.
2. Light and dark both readable; HUD contrast preserved.
3. `workbenchReduceMotion=true` freezes cloud/sun animation.
4. No regression: zone clicks, mascot plots, metrics still work.
5. `WorkbenchPage` tests green; farm sky testid queryable.

---

## 10. Out of scope follow-ups

- Seasonal palettes
- Parallax on pointer move
- Redesign of plot diamond faces
- Photo mode toggle
