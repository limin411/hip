# hip 工作台 · Pixel Farm Mini-Game（像素种田）

| 字段 | 值 |
|------|-----|
| **Title** | Workbench Pixel Farm — interactive pixel farming hub |
| **Date** | 2026-07-29 |
| **Status** | **Active** — P1/P2 shipped (pixel sky, dialog HUD, plot buildings, single field hero) |
| **Supersedes** | [`2026-07-29-workbench-ambient-home.md`](./2026-07-29-workbench-ambient-home.md) as default workbench shell |
| **Builds on** | `IsoFarmMap` / `FarmSky` / `zoneProgress` / GSAP (in-repo) |
| **Audience** | Engineers on `src/components/workbench/` |

---

## 1. Overview

工作台冷启动页从 **Linear 式冷静列表** 升级为 **像素风种田小游戏枢纽**：

- 每个功能面（sessions / tasks / …）是一块可交互的 **菜畦**
- 作物生长反映 `zone.progress` / `zone.state`
- 农夫吉祥物在田里劳作（既有 `public/motion/*`）
- 点击菜畦 = 打开对应功能面；旁侧 **工具棚 Dock** 承载 Continue / Quick start / Recent
- 动效用 **GSAP** 做「浇水 / 弹跳 / 收获火花」；**不用 Three.js**（像素 2D 场景用 3D 引擎过重且易糊）

**一句话**：工作台是「你的 AI 农庄」——好玩可点，但仍是只读总览 + 跳转枢纽，不是第二个任务系统。

---

## 2. Case study takeaways（网络调研）

| 案例 / 方向 | 技术 | 可借原则 |
|-------------|------|----------|
| **JSLegendDev 2D gamified portfolio** (Kaboom) | Canvas 2D 引擎 | 地图即导航：走进/点击场景物体 = 打开内容 |
| **Retro CSS gamified portfolio** (DEV / React+CSS) | DOM + 手绘像素 | 无重引擎也可做出可达的像素房间；键盘/焦点友好 |
| **stardewOS** | HTML + SASS | Stardew 色板 + 窗框 UI 能把「系统壳」装进种田美学 |
| **Phaser / Pixi** | 完整游戏引擎 | 适合真游戏；对桌面产品首页 **过重**（bundle、焦点、a11y） |
| **Three.js demos** | WebGL 3D | 适合 3D 场景；**不适合** crisp pixel art（抗锯齿/滤镜易糊） |
| **GSAP 微交互案例** | 时间轴 / spring | 点击弹跳、粒子火花、收割反馈 — 低成本「游戏手感」 |
| **MDN crisp pixel** | `image-rendering: pixelated` + 低分辨率放大 | 像素资产与缩放必须硬边 |

**技术选型结论（锁定）**

| 选型 | 决策 |
|------|------|
| 渲染 | **DOM + CSS** 等距菜畦（复用 `IsoFarmMap` 布局） |
| 像素感 | CSS：硬边、2–3px 边框、方块云/太阳、dither 草地、`image-rendering: pixelated` |
| 动效 | **GSAP** 可选增强；CSS keyframes 作 fallback；`workbenchReduceMotion` 冻结 |
| 3D | **不**默认挂载 Three `CosmosHost` |
| 引擎 | **不**引入 Phaser / Kaboom / Pixi |

---

## 3. Product model

```
WorkbenchPage
└── PixelFarmShell
    ├── FarmSky (pixel skin)           decorative
    ├── FarmHud                        hero + metrics + mascot
    ├── FarmStage                      scrollable iso world
    │   ├── ground (pixel meadow)
    │   ├── PixelPlot × zones          click → openZone
    │   └── ambient (birds / sparkles)
    └── FarmDock                       continue / attention / quick / recent
```

### 业务边界（不变）

- 数据：`useWorkbenchSnapshot` → `buildZoneModels` / `aggregateHero`
- 导航：既有 `openZone` / `sidebarActions` / `sessionService`
- **不**新建任务实体；**不**持久化游戏存档；「浇水」仅为本地微反馈

### 迷你游戏层（装饰 + 反馈）

| 交互 | 行为 | 是否改业务状态 |
|------|------|----------------|
| 点击菜畦 | GSAP pop + 打开 zone | 否（只跳转） |
| Hover 菜畦 | 抬升 / 作物闪一下 | 否 |
| Running 态 | 浇水粒子循环 | 否 |
| Done 态 | 成熟果子 + 可选收获火花 | 否 |
| Dock 按钮 | 与 Calm Home 相同快捷入口 | 否 |

可选未来：localStorage 记录「今日浇水次数」成就 — **v1 不做**。

---

## 4. Visual dialect（像素种田）

### 4.1 原则

1. **Hard edges**：圆角最多 2–4px；避免大半径 glassmorphism 作为主风格
2. **Chunky chrome**：HUD / Dock 用双层方框（外深边 + 内高光），类似 SNES 对话框
3. **Crop = state**：idle 幼苗、running 抽条+水花、done 果实、blocked/fail 枯萎倾斜
4. **Progress bar**：菜畦侧面或牌子上 0–100% 方块格进度
5. **Light / dark**：两套土壤/天空 token；禁止整页 `brightness()` 硬压
6. **品牌**：暖橙 accent 用于焦点环与 primary 快捷格；角色色仅 plot accent

### 4.2 分层

```
z↑  FarmDock / HUD (interactive)
│   plots + signs + mascots
│   iso-ground (pixel soil oval)
│   meadow / ridge / mountains
│   atmosphere (sun, clouds)
└── sky gradient
```

### 4.3 Motion gates

- `workbenchReduceMotion` **或** `prefers-reduced-motion` → `data-motion="static"`：无云/水花/吉祥物 bob、无 GSAP
- `workbenchShowScene=false` → 静态 logo 替代 motion 剪辑（既有 `IsoMascot` 行为）

---

## 5. Component contract

### `PixelFarmShell`

```tsx
export function PixelFarmShell(props: {
  zones: ZoneModel[]
  hero: HeroModel
  heroTitle: string
  heroSubtitle: string
  selectedId: string | null
  onOpenZone: (zone: ZoneModel) => void
}): JSX.Element
```

- Root: `data-testid="workbench-farm"` + `data-motion` + `data-hero-state`
- 保留既有 testids：`workbench-hero`、`workbench-modules`、`workbench-zone-*`、`workbench-metric-*`、`workbench-continue`、`workbench-shortcuts`、`workbench-recent`

### `IsoPlot`（增强）

- 点击：`playPlotClickJuice(el)` then `onOpen(zone)`
- `data-growth={0|1|2|3}` 由 progress/state 派生
- 保留 a11y：`aria-label` 含名称、状态、指标

### GSAP juice (`farmJuice.ts`)

```ts
playPlotHover(el: HTMLElement): void
playPlotClick(el: HTMLElement): void  // scale punch + optional spark particles
killFarmJuice(el: HTMLElement): void
```

- 动态 `import('gsap')` **或** 静态 import（项目已依赖 gsap）
- reduce-motion 时 no-op

---

## 6. Information architecture（相对 Calm Home）

| Calm Home | Pixel Farm |
|-----------|------------|
| AmbientBackdrop mesh | FarmSky 像素远景 |
| HomeHeader | FarmHud（像素框） |
| SurfaceRow 列表 | Iso 菜畦网格 |
| Continue / Attention / Quick / Recent 分栏 | 底部/侧 **FarmDock** 像素面板 |

信息 **不得**丢失：Continue、Attention（有数据时）、Quick start、Recent sessions 必须可点。

---

## 7. File plan

```
docs/design/2026-07-29-workbench-pixel-farm.md   # this spec
src/components/workbench/
  WorkbenchPage.tsx                              # → PixelFarmShell
  farm/
    PixelFarmShell.tsx
    FarmDock.tsx
    farmJuice.ts
    pixelFarm.css                                # pixel skin + dock
  map/
    IsoFarmMap.tsx                               # used inside shell or folded
    IsoPlot.tsx                                  # juice + growth
    FarmSky.tsx / isoFarm.css                    # keep + pixel tweaks
```

---

## 8. i18n

扩展 `workbench.farm.*`：

| Key | EN intent |
|-----|-----------|
| `farm.kicker` | Sunny field → **Pixel farm** |
| `farm.hint` | Click a plot to open a surface |
| `farm.dock` | Toolshed (aria) |
| `farm.water` | sr-only: watering feedback (optional) |

其它语言：zh-CN / zh-TW / ja / ko 同步。

Settings 文案：`workbenchShowScene` / `workbenchReduceMotion` 描述改为农场语境（场景动效 / 减少动效）。

---

## 9. Acceptance criteria

1. 冷启动 `WorkbenchPage` 渲染 **像素农场**，无 Calm Home `workbench-home` / ambient mesh 为默认。
2. 6 个 zone 菜畦可键盘聚焦、点击打开（sessions → chats 等既有路径）。
3. Continue / Quick start / Recent 在 Dock 可用；有 fail/blocked 时 Attention 出现。
4. `workbenchReduceMotion=true` → `data-motion="static"`，无循环动画与 GSAP。
5. Light/dark 均可读；HUD/牌子对比足够。
6. `WorkbenchPage` vitest 绿；testid 契约更新通过。

---

## 10. Non-goals (v1)

- 真实经济系统 / 背包 / 多日存档
- 可步行角色 + 碰撞（Kaboom 级 RPG）
- Three.js / Phaser
- 替换侧栏导航
- 删除 `home/` 源文件（可保留未挂载，便于回滚）

---

## 11. Plan

| Step | Work | Done when |
|------|------|-----------|
| **P0** | Spec | 本文档落地 |
| **P1** | `farmJuice` + IsoPlot growth/click | 点击有 punch |
| **P2** | `PixelFarmShell` + `FarmDock` + CSS | 农场 + dock 一体 |
| **P3** | Wire `WorkbenchPage` + i18n | 冷启动即农场 |
| **P4** | Tests + typecheck | 绿 |

---

## 12. Rollback

`WorkbenchPage` 改回 `HomeShell` 即可恢复 Calm Home；农场代码留在 `farm/` + `map/`。
