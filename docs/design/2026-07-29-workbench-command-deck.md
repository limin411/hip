# hip 工作台 — Calm Home（Linear 式总览）

| 字段 | 值 |
|------|-----|
| **Title** | hip Workbench · Calm Home |
| **Date** | 2026-07-29 |
| **Status** | Superseded by pixel farm: `2026-07-29-workbench-pixel-farm.md` |
| **Replaces** | Farm cartoons · Command Deck (Three/GSAP sci-fi) — later Calm Home, then Pixel Farm |

---

## Overview

工作台冷启动页为 **克制的产品首页**，设计参照 **Linear / Raycast / Apple Settings**：

- 编辑向中栏布局（~704px）
- 问候 + 一行状态说明
- 横排数字摘要（细线分隔，无霓虹 pill）
- **功能面列表**（Linear 式行：图标 / 标题 / 指标 / 状态 / chevron）
- **快捷入口** 行（ghost / outline 按钮）

**明确不做**：3D 场景、扫描线、玻璃 HUD、卡通田地。

数据层仍为 `useWorkbenchSnapshot` + `zoneProgress` + `openZone` 跳转。

## Structure

```
WorkbenchPage
└── HomeShell
    ├── HomeHeader (title, subtitle, stats)
    ├── SurfaceRow × N
    └── QuickStart
```

## Settings

- `workbenchReduceMotion` — 弱化过渡（可选）
- 已移除 `workbenchShowScene` UI（store 字段可保留迁移兼容）

## Visual rules

1. 仅 hip tokens（中性灰 + 暖橙点缀）
2. 角色色只用于图标底与 active 状态
3. 1px `var(--border)` 列表外框
4. hover = `var(--state-hover)`，无抬升阴影剧场
