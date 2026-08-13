# hip 基础视觉整改规格 — 层次 / 对比 / 焦点 / 动效语义

> 系列:`ui-foundation-clarity` ｜ 配套:`ui-foundation-clarity-plan.md`(PR 拆分)、`ui-foundation-clarity-preview.html`(对照预览,浏览器直接打开)
> 当前基线:`DESIGN.md`(Flat Solid / 纯 fade / 中性灰阶)与 `src/styles/tokens.css`(权威来源)
> 原则:本系列只改 token 与少数字段组件,**不动信息架构与功能**;对比度以规则为验收标准,hex 仅为裁决值。

---

## 0. TL;DR

体检发现的 12 项问题归为四类根因:

1. **中性灰执行过度**:hover 底与所在面只差 1.05–1.14:1,选中态 1.2:1 —— "安静"变成"无反馈"。
2. **暗色阶差失守**:四层表面只差 1.04–1.06:1,且主列比侧栏还暗(层级反向),分层只剩弱边框。
3. **键盘焦点缺口**:输入域仅 `outline-none` 无 ring,与 DESIGN.md 承诺矛盾;11–12px tertiary 文字在次级表面 4.08–4.23:1,不达 AA。
4. **动效无语义 + 品牌缺席**:所有动效同一种 100–240ms fade;主 CTA 全部软黑,品牌橙只出现在小圆点。

整改后新增的"允许清单"仅一条:**例外③ 面板宽度过渡**(右栏抽屉,`--duration-panel 220ms`),其余继续遵守纯 fade/背景色纪律。

## 1. 决策总表(T 裁决)

| # | 裁决 | 结论 |
|---|---|---|
| T1 | hover/选中加深力度 | 规则制:hover ≥1.2:1、选中 vs hover ≥1.1:1;裁决值见 §3 |
| T2 | 焦点环颜色 | **中性灰**(`ring-ink/25`),不违反 `check-visual-dialects` 的 ring-accent 禁令;DESIGN.md 原文"accent focus ring"按代码事实修正 |
| T3 | 品牌 CTA 范围 | 新增 `brand` 变体,仅 Composer 发送、空状态主 CTA 两处;36 处 `primary` 软黑**不动** |
| T4 | 暗色层级方向 | 主列(#161616)应介于 app(#101010)与侧栏(#1c1c1c)之间 —— 修复反向 |
| T5 | 侧栏默认宽度 | 300 → **280**(文档 264 与代码 300 折中;知识库树视图受益) |
| T6 | danger 呼吸 | 空闲态静态 `border-danger-soft`,仅运行中保留 `danger-flow` 旋转 |
| T7 | msg-enter-left/right | 弃用,统一 `message-enter`;keyframes 保留一个版本(deprecated 注释) |
| T8 | 主题切换 | 原子化:切换期 150ms 全局统一颜色过渡(`data-theme-switching`) |

## 2. 基线测量(2026-08-13 实测,WCAG 对比度)

| 组合 | 实测 | AA 阈值(小字 4.5:1) | 判定 |
|---|---|---|---|
| hover #f0f0f0 / 白 #ffffff | 1.14 | — | 不可见 |
| hover #f0f0f0 / 侧栏 #F6F5F3 | 1.05 | — | 不可见 |
| 选中 #e6e6e6 / #F6F5F3 | 1.15 | — | 微弱 |
| tertiary #757575 / #ffffff | 4.61 | ✓ | 勉强过 |
| tertiary #757575 / #F6F5F3 | 4.23 | ✗ | 不达标 |
| tertiary #757575 / #f1f1f1 | 4.08 | ✗ | 不达标 |
| secondary #5e5e5e / #F6F5F3 | 5.95 | ✓ | 达标 |
| 暗色 subtle #161616 / app #0f0f0f | 1.06 | — | 阶差失守 |
| 暗色 content #141414 / app #0f0f0f | 1.04 | — | 且层级反向 |
| 暗色 border #333333 / app #0f0f0f | 1.52 | — | 仅剩的弱分层 |
| 暗色 tertiary #8a8a8a / #161616 | 5.37 | ✓ | 达标(不动) |

来源:运行态 DOM 实测(1280×720) + `src/styles/tokens.css` 代码审计;预览页 § 底部面板可复算。

## 3. P0-1 hover / 选中可见性(亮色)

- **目标面**:`--accent-subtle`(hover 底)、`--accent-active`(选中底),及派生 `--state-hover/--state-active`、`SIDEBAR_ACTIVE_RAIL`。
- **现状**:#f0f0f0 / #e6e6e6,实测 1.05–1.21:1,几乎无反馈。
- **提案**:
  - `--accent-subtle: #f0f0f0 → #dfdfdf`(vs 白 1.33,vs 侧栏 #F6F5F3 1.22)
  - `--accent-active: #e6e6e6 → #d3d3d3`(vs 白 1.50,vs hover 1.12)
  - `--tbl-row-hover: rgba(0,0,0,.045) → rgba(0,0,0,.12)`(表格域同步,≈1.22:1 与行 hover 同档)
  - `--accent-subtle-rgb` 三通道同步(224 223 223 / 211 211 211)。
- **影响面**:侧栏/导航/列表行 hover 与选中、chip 底、头像底、消息高亮(`bg-accent-subtle` 搜索跳转高亮会变深,属预期,2s 自动消退)。
- **验收**:行 hover 肉眼可感知;选中行与 hover 行可区分;不引入品牌 tint;`check:visual-dialects` OK(仍走 `hover:bg-state-hover`,无直写 accent-subtle)。

## 4. P0-2 暗色表面阶差与层级方向

- **目标面**:`.dark` 的 `--bg-app / --bg-subtle / --bg-content / --bg-muted / --border / --border-strong`。
- **现状**:#0f0f0f / #161616 / #141414 / #1e1e1e,#333/#454545;阶差 1.04–1.06:1,且 content < subtle(主列比侧栏暗)。
- **提案**:

| token | 旧 | 新 | 相对 app 对比度 | 说明 |
|---|---|---|---|---|
| --bg-app | #0f0f0f | #101010 | — | 基面 |
| --bg-content | #141414 | #161616 | 1.05 | 主列,介于 app 与 subtle |
| --bg-subtle | #161616 | #1c1c1c | 1.12 | 侧栏/composer,比主列亮 |
| --bg-muted | #1e1e1e | #262626 | 1.26 | 气泡/代码块容器 |
| --border | #333333 | #3a3a3a | 1.67 | 边框可见度修复 |
| --border-strong | #454545 | #4d4d4d | 2.25 | 输入框外框 |
| --accent-subtle | #222222 | #2f2f2f | 1.42(vs subtle 1.27) | hover(GitHub 级 ~1.26 参照) |
| --accent-active | #2e2e2e | #3d3d3d | 1.75(vs hover 1.23) | 选中 |

  - 层级方向统一:**app < content < subtle < muted**,亮色(white > #F6F5F3 > #f1f1f1)同构。
  - `--tbl-header-bg #242320`、`--tbl-row-num-bg #201f1d` 按新 muted 微调(#2b2a28 / #262523),保持与 muted 同档。
- **验收**:暗色下四层表面与边框肉眼可分;composer 卡片轮廓清晰;侧栏与主列明暗方向与亮色一致。

## 5. P0-3 文字对比度(tertiary)

- **目标面**:`--text-tertiary` 及其 `-rgb` 三通道。
- **现状**:#757575,在 #F6F5F3 / #f1f1f1 上 4.23 / 4.08:1;而 caption(11px)/meta(12px) 是 tertiary 的默认搭配(时间戳、状态行、占位符、工具行)。
- **提案**:`--text-tertiary: #757575 → #6a6a6a`(vs 白 5.41,vs subtle 4.96,vs muted 4.79,全部过 4.5)。
- **不变**:`--text-secondary #5e5e5e`(5.95 已达标);暗色 tertiary #8a8a8a(5.37 达标)。
- **验收**:`src/styles/tokens.test.ts` 断言 §2 表全部组合 ≥4.5;目检时间戳/占位符仍属"三级"而非跳到二级。

## 6. P0-4 焦点可见性(focus ring)

- **目标面**:`src/components/ui/focusClasses.ts` 的 `focusField`;`Textarea.tsx` / `Input.tsx`;`Composer.tsx`。
- **现状**:`focusField = 'focus-visible:outline-none'`(只删浏览器轮廓);Composer textarea 另有 `focus-visible:ring-0`;唯一反馈是卡片边框 #e0e0e0→#c9c9c9(1.32→1.66:1)。
- **提案**:
  1. `focusField` → `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25`(中性灰,与 `focusChrome` 同族;T2 裁决不用 accent)。
  2. 删除 Composer 的 `focus-visible:ring-0`;卡片保留 `focus-within:border-border-strong` 作为第二指示。
  3. 全仓输入域裸 `outline-none` 排查,统一收敛到两个 focus 类。
- **验收**:Tab 走查(设置页输入、Composer、命令面板、搜索框)焦点 ring 可见;不新增 `ring-accent`(门禁守护)。

## 7. P1-1 品牌 CTA(brand 变体)

- **目标面**:`src/components/ui/Button.tsx`、`Composer.tsx`(发送按钮)、`FirstRunSetupCard.tsx`。
- **现状**:主按钮 = `--btn-primary #3a3a3a` 软黑,全产品唯一 accent 实底是 Switch 选中轨与状态点;产品无识别度。
- **提案**:
  1. `Button` 新增 `brand` 变体:`bg-accent text-on-accent hover:bg-accent-hover`(亮:橙底白字;暗:#ffb300 底近黑字)。
  2. 替换仅 2 处:Composer 发送按钮(`variant="brand"`)、FirstRunSetupCard"打开模型设置"。
  3. 规则:**每屏至多 1 个 brand CTA**;danger 确认流维持 danger 实底;36 处 primary 不动。
  4. `disabled` 沿用 `opacity-40`(现有变体行为)。
- **验收**:空状态与会话 Composer 的发送为橙实底;发送禁用态无"灰底变橙"的闪烁(变体切换同尺寸同圆角,只有颜色过渡,`duration-chrome` 覆盖)。

## 8. P1-2 右栏抽屉开合动画(动效例外③)

- **目标面**:`src/routes/AppLayout.tsx` 右栏 Panel(`collapsedSize={0}`、`collapsible`)。
- **现状**:关闭时内容直接卸载(`{rightOpen ? ... : null}`),打开时窗口先变宽 + 面板闪现 + 内容 `animate-panel-in` 淡入;无宽度过渡。
- **提案**:
  1. 新增 token `--duration-panel: 220ms`;全局 CSS 给 `[data-panel]`(react-resizable-panels v2)加 `transition: flex-basis var(--duration-panel) var(--ease-standard)`。
  2. 打开:内容先挂载 → 面板宽度 0→目标(220ms)→ 内容 `animate-panel-in` 随宽度展开淡入。
  3. 关闭:先收起宽度(220ms)→ 过渡结束后卸载内容(`panelClosing` 状态 + `transitionend` 兜底定时器);期间手柄禁用。
  4. `widenWindowForRightPanel` 与面板过渡解耦:窗口先到位,面板再展开,避免主列被双重挤压。
  5. `prefers-reduced-motion`:全局 0.01ms 兜底已覆盖 flex-basis 过渡,行为回到直切(验收确认)。
- **验收**:开合平滑、无内容弹跳;拖拽 min 宽度钳制不变;右栏开关 e2e(`@panel`)全绿。

## 9. P1-3 动效语义分层 + 主题切换原子化

- **目标面**:`tailwind.config.js` animation 时长、`ThemeProvider.tsx`。
- **现状**:menu/modal/panel/view/message 全部 100–240ms 纯 fade,操作层级无法区分;主题切换时带 transition 的表面渐变、不带的面瞬切,出现"半亮半暗"帧(实测复现)。
- **提案**:
  1. 时长分层(纯 fade 纪律不变,只分节奏):
     - menu:in 110ms / out 90ms(轻量浮层)
     - modal:in 160ms / out 120ms(模态)
     - view-enter:200ms(整视图切换)
     - panel-in:200ms(右栏内容,配合宽度过渡)
     - message-enter:240ms(消息,流式例外)
  2. 主题切换:ThemeProvider 切换 `.dark` 前后给 `<html>` 加 `data-theme-switching`:
     ```css
     html[data-theme-switching] *, html[data-theme-switching] *::before,
     html[data-theme-switching] *::after {
       transition: background-color .12s var(--ease-standard),
                   color .12s var(--ease-standard),
                   border-color .12s var(--ease-standard) !important;
     }
     ```
     150ms 后移除属性 → 全表面同步渐变,消除混合帧。
- **验收**:快切主题截图无混合中间态;菜单与模态入场节奏可感知差异;reduced-motion 下全部 0.01ms。

## 10. P2 布局修整

| 项 | 现状 | 提案 |
|---|---|---|
| 侧栏默认宽度 | `SIDEBAR_WIDTH_DEFAULT = 300`(文档 264) | **280**(T5;min 200 / max 480 不变) |
| 设置页行宽 | `px-8` 无 max-w,1600px 窗口行拉满 | 内容容器 `max-w-[880px] mx-auto`(SettingsPanel body) |
| 微命中区 | "新建对话/新建任务" 56×19;"重试" 22×11;Composer"模式选择" 82×20 | 文字按钮统一 `min-h-6`(24px)+ `px-1`;重试链接 `px-0.5 py-0.5` |
| 滚动条 | hover/滚动时 5px thumb | 维持现状(验收确认 hover 面板时 thumb 可见即可) |

## 11. P2 清理项

1. `Switch.tsx` 移除 `active:scale-90`(违禁缩放)。
2. `msg-enter-left/right` 弃用(它们只是纯 fade 的命名残留),`ChatPane` 改用 `animate-message-enter`;keyframes 保留一个版本带 deprecated 注释。
3. Composer danger:空闲态 `.composer-danger-glow`(2.2s 无限呼吸)删除,静态 `border-danger-soft`;仅运行中保留 `danger-flow` 旋转(文档明示例外)。

## 12. 回归清单与文件

| 文件 | 改动 |
|---|---|
| `src/styles/tokens.css` | §3–§6 token + §8 `--duration-panel` + §9 `data-theme-switching` + §11 danger glow 移除 |
| `tailwind.config.js` | animation 时长(§9)、`msg-enter-*` 弃用注释、rgb 三通道同步 |
| `src/components/ui/focusClasses.ts` | `focusField` 补 ring(§6) |
| `src/components/ui/Button.tsx` | 新增 `brand` 变体(§7) |
| `src/components/chat/Composer.tsx` | 发送按钮 brand + 去 ring-0(§6/§7) |
| `src/components/chat/FirstRunSetupCard.tsx` | CTA brand(§7) |
| `src/components/chat/ChatPane.tsx` | `animate-message-enter`(§11) |
| `src/components/ui/Switch.tsx` | 去 scale(§11) |
| `src/routes/AppLayout.tsx` | 右栏开合状态机(§8) |
| `src/components/layout/sidebarWidth.ts` | 默认 280(§10) |
| `src/components/account/SettingsPanel.tsx` | max-w 880(§10) |
| `src/components/layout/ConnectionStatus.tsx` / `AppSidebar.tsx` | 微命中区(§10) |
| `src/components/theme/ThemeProvider.tsx` | 切换原子化(§9) |
| `src/styles/tokens.test.ts`(新增) | 对比度规则单测(§2 表) |
| `DESIGN.md` | 全量同步(PR-7) |

## 附录 A 手动走查清单

- [ ] 亮色:侧栏 hover/选中、消息高亮、chip、表格行 hover
- [ ] 暗色:四层表面 + 边框、composer 卡片、代码块、表格
- [ ] Tab 焦点:设置页输入、Composer、命令面板、搜索框(灰 ring)
- [ ] 品牌 CTA:空状态发送、会话发送(橙实底,每屏唯一)
- [ ] 右栏:开合动画、拖拽、窄窗口 min 钳制
- [ ] 主题:快切无混合帧;reduced-motion 全冻结
- [ ] 门禁:`yarn tsc` / `yarn test` / `yarn check:visual-dialects`
