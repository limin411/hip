# hip 大眼睛 LOGO — 设计 & 接入 spec

**日期:** 2026-06-12
**状态:** 已批准方向，进入实现
**取代:** `2026-06-11-login-hero-butt-logo-design.md` 的桃子/屁股 mark（peach DNA 完全移除）

## 背景

用户给出参考图 `cookie-monster-color.figma.site` —— 一张 Pantone 色卡海报，色块本身写着
`#0062AD / Cookie Monster / Sesame Street`，配两只大 googly 眼睛（cream 圆 + 黑瞳）。
关键洞察：那个色号 **正是 hip 的品牌蓝 `#0062AD`**。参考 = 用 hip 自己的蓝、扮成 Cookie Monster。

经发散（6 概念）+ 评审 + 真机渲染自检，定方向 **A · 大眼睛** 为正式主标识。
理由：最忠于参考的 #0062AD 梗；16px 仍成立；无缝接入既有 cream-on-blue 图标系统；
对「摸鱼」（瞄一眼老板有没有看）和「AI agent 盯着你的代码」双重契合。

## 决策（用户已确认）

- **桃子：完全替换删除** —— HipLogo 内 peach DNA 及其专属动画全部移除。
- **实施范围：全量接入** —— 组件 + app 图标 + favicon + 登录 hero（含动画），跑 type-check + GUI 验收。

## 标识 DNA（viewBox `0 0 120 120`）

调色板（仅限 logo 局部，不进全局 token，沿用 coral 当年的隔离约定）：

| 角色 | hex |
|------|-----|
| tile 底 / 品牌蓝 | `#0062ad` |
| 眼白 cream | `#f4ecd8` |
| 瞳孔 navy | `#003b68` |
| 高光 white | `#ffffff` |

几何（两眼略叠，瞳孔朝右下「斜瞄」）：

- 眼：`L(42,58)` `R(78,58)`，`r=24`，fill cream
- 瞳：`L(49,65)` `R(85,64)`，`r=10.5`，fill navy
- 高光：`L(45.5,61.5)` `R(81.5,60.5)`，`r=3`，fill white

## HipLogo 组件变体（API 改版）

`variant: 'tile' | 'minimal' | 'hero' | 'mono'`，默认 `tile`（旧默认 `color` 删除；
全仓仅 LoginScreen 用 `hero`，无破坏）。

- **tile** — 圆角蓝砖（`rect 4,4,112,112 rx26`）+ 眼 + 瞳 + 高光。通吃：app 图标 / favicon / 内联品牌。
- **minimal** — 同 tile 但去高光、瞳 `r=12`，给 16px favicon 兜底。
- **mono** — 透明底，眼为描边圈（`stroke=currentColor`）+ 实心瞳（`fill=currentColor`），
  供菜单栏模板图标 / 单色场景；颜色由调用方 `color` 决定。
- **hero** — 仅眼（无砖），放大填充，叠在 LoginScreen 蓝色渐变上；带柔光 + 眨眼 + 斜瞄动画。
  hero 几何放大版：`r=30`，cy=60，瞳 `L(51,69) R(87,68) r=13`，高光 `r=3.8`。

## 动画（tokens.css，替换桃子动画）

移除：`peach-bounce` / `leaf-wiggle` / `shadow-squash` / `sparkle-twinkle` 及对应 class。
新增：

- `hip-blink` (~4.5s) — 整组 `scaleY` 瞬时压扁再弹回 = 眨眼。
- `hip-glance` (~5s) — 瞳孔组 `translate` 小幅左右扫视 = 摸鱼瞄一眼。
- `hip-glow-breathe` (3s) — 柔光呼吸（保留，glow 改 cream `rgba(244,236,216,…)`）。

均靠既有 `@media (prefers-reduced-motion: reduce)` 全局兜底自动禁用。
SVG 变换用 `transform-box: fill-box; transform-origin: center`。

## 接入清单（文件）

| 文件 | 改动 |
|------|------|
| `src/components/login/HipLogo.tsx` | 重写：眼睛 DNA + 新 variant API + hero 动画结构；删 peach/leaf/sparkle/shadow |
| `src/styles/tokens.css` | 删桃子动画，加 blink/glance/glow（cream） |
| `src/routes/LoginScreen.tsx` | 注释「蜜桃 hero」→「大眼睛 hero」；用法不变（variant="hero"） |
| `src-tauri/icons/source/app-icon.svg` | 换成 tile 眼睛砖；注释更新 |
| 图标二进制 | `yarn tauri icon src-tauri/icons/source/app-icon.svg`（命令支持 SVG 直接输入） |
| `public/hip.svg` | 新增 = tile 砖，做真 favicon |
| `index.html` | favicon `/vite.svg → /hip.svg`；`<title>` `Tauri + React + Typescript → hip` |

## 验收

- `yarn type-check` 通过。
- 渲染自检：tile/minimal/mono/hero 全尺寸 + 16px favicon（已用 Playwright 截图自检调色板/可读性）。
- GUI 验收（手动）：登录页 hero 眨眼/斜瞄动作自然；dock 图标换成大眼睛；favicon 生效。
  （纯 UI/FS 改动，无 LLM，按既有「GUI 验收优先」约定。）

## 非目标

- 不动全局 token / 不把 cream 提为全局色。
- 不重构 LoginScreen 其余部分。
- mono 变体仅落组件，暂不接菜单栏（菜单栏接入另开）。
