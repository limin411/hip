# hip 功能图标系统升级 Spec v2

> 状态：提案（待评审） · 配套高保真预览：`docs/design/icon-upgrade-preview.html`（浏览器直接打开，亮/暗双主题）
> 本文档与预览中的设计完全一致；SVG path 全集见 §6，可直接照抄实现。

## 1. 背景与现状

当前图标体系为「lucide-react 全库散用」：`src/` 下 135 个组件文件直接引用 ~110 个 Lucide 图标，
无统一参数、无品牌图标、无图标级状态表达。全库扫描数据：

| 维度 | 现状 | 问题 |
|---|---|---|
| strokeWidth | `1.5 / 1.6 / 1.75 / 2 / 2.5` 五种并存（1.75×143 处为主） | 粗细漂移，界面噪点 |
| 尺寸 | `14 / 16 / 18 / 20 / 24` 五档混用（14×213、16×45、其余少量） | 层级失序 |
| 侧栏导航 | MessageSquare / Code2 / FolderTree / Terminal / CheckSquare / Zap | 形状雷同、无品牌识别度 |
| 语义 | Zap 同时承担「自动化」与「快/加速」；Folder 家族 4 个图标混用 | 语义含混 |
| 状态 | active 仅灰底（`bg-state-active`），图标不参与 | 状态表达单一 |

## 2. 设计目标与原则（对齐 DESIGN.md）

1. **直角优先** —— 品牌图标描边端点/连接用 `square`（直角），与 Lucide 圆头描边形成差异层级：圆头=通用，直角=品牌。
2. **单色为主，一色强调** —— 图标默认继承文字色（`text-secondary`）；仅导航选中态用 accent 橙。禁止渐变、发光、多彩填充；角色色只保留给 agent 角色指示点（不进入图标本体）。
3. **语义即形状** —— 每个功能图标携带一个可在 16px 下辨认的「记忆点」。
4. **零新增依赖** —— 品牌图标为内联 SVG React 组件，兼容 `LucideIcon` 类型签名；无图标字体、无网络字体、无第三方图标库。

## 3. 方案对比

| 方案 | 描述 | 评价 |
|---|---|---|
| A. 品牌图标 + Lucide 通用（**推荐**） | 6 个自绘品牌功能图标（导航/空状态），通用图标继续用 Lucide 并统一参数 | 品牌识别度↑，工作量 ~1 天，可渐进合入 |
| B. 仅换 Lucide 图标名 | 零新增代码，换几个语义更准的图标 | 治标不治本，无品牌差异 |
| C. 引入新图标库（Iconify/自绘全套） | 风格最统一 | 违背「零新增依赖」；全量替换 ~135 文件，回归成本高，**否决** |

## 4. 统一规格

| 参数 | 规范 |
|---|---|
| 网格 | 24×24 viewBox，安全区 16×16（留 8px 呼吸边），与 Lucide 同网格可混排 |
| 描边 | **1.75（全库唯一）**；仅 24px 品牌展示级用 1.5 |
| 圆角 | 品牌图标内部图形圆角 ≤2（`r="2"`），与外框 2px 按钮、4px 卡片同语言 |
| 端点 | 品牌图标 `stroke-linecap="square" stroke-linejoin="miter"`；Lucide 保持其 round 风格 |
| 尺寸 | `14` 内联 meta · `16` 默认（导航/工具栏/按钮）· `18` 列表行 · `20` 空状态 · `24` 仅品牌展示 |

## 5. 六大品牌功能图标设计

设计原则：每个图标一个记忆点；图形在 16px（约 6.7mm）下仍可辨认；填充元素仅用于「强调点」
（会话圆点、终端状态点、知识星标、自动化闪电），面积占比 <10%。

| 功能 | 旧（Lucide） | 新（hip 品牌） | 记忆点 |
|---|---|---|---|
| 会话 | MessageSquare 单气泡 | **ChatsIcon** 双气泡交叠 | 交谈感 |
| 项目 | Code2 斜杠代码 | **ProjectsIcon** 文件夹 + `</>` | 代码仓库 |
| 知识库 | FolderTree 文件夹树 | **KnowledgeIcon** 打开的书 + 星标书签 | 文库 |
| 终端 | Terminal 裸提示符 | **TerminalsIcon** 窗口 + 状态点 + 提示符 | 运行容器 |
| 任务 | CheckSquare 单勾选框 | **TasksIcon** 勾选清单（已勾 + 待办行） | 清单 |
| 自动化 | Zap 闪电 | **AutomationIcon** 循环圆环 + 闪电 | 重复执行 |

### 5.1 SVG path 全集（24×24，可直接实现）

```tsx
// ChatsIcon —— 主气泡 + 右上副气泡（多路会话）
stroke: <path d="M4.5 5.5h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-4.4l-3 2.8v-2.8H4.5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"/>
        <rect x="10.5" y="2" width="10.5" height="7" rx="2"/>
        <path d="M12.6 10.5h2.4"/><path d="M14.4 6h4"/>
fill:   <circle cx="6" cy="10.5" r="1.05"/><circle cx="9.5" cy="10.5" r="1.05"/>

// ProjectsIcon —— 文件夹 + 尖括号代码
stroke: <path d="M3.5 9.5v7a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2h-7l-1.9-2h-4.1a2 2 0 0 0-2 2z"/>
        <path d="M9.4 12.4 7.9 13.9l1.5 1.5"/><path d="M14.6 12.4l1.5 1.5-1.5 1.5"/><path d="M13.2 11.9 11.6 15.9"/>

// KnowledgeIcon —— 打开的书（折线页）+ 四角星书签
stroke: <path d="M4.8 5.2h4.5L12 6.9v11.8L9.3 17.2H4.8z"/><path d="M19.2 5.2h-4.5L12 6.9v11.8l2.7-1.5h4.5z"/>
        <path d="M12 6.9v11.8"/>
        <path d="M6.2 8.8h2.7"/><path d="M6.2 11.3h2.7"/><path d="M6.2 13.8h1.8"/>
        <path d="M15.2 8.8h2.7"/><path d="M15.2 11.3h2.7"/><path d="M16.2 13.8h1.7"/>
fill:   <path d="M19.9 3.7l.72 1.98 1.98.72-1.98.72-.72 1.98-.72-1.98-1.98-.72 1.98-.72z"/>

// TerminalsIcon —— 终端窗口 + 运行点 + 提示符
stroke: <rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/>
        <path d="M10.8 10.6l2.9 2.6-2.9 2.6"/><path d="M16.8 15.8h3"/>
fill:   <circle cx="7.2" cy="8" r="1.15"/>

// TasksIcon —— 勾选框 + 待办行
stroke: <rect x="3" y="3" width="8" height="8" rx="2"/>
        <path d="M5 7.2l1.7 1.7 2.9-3.5"/>
        <path d="M14 6h6.8"/><path d="M14 10.2h6.8"/><path d="M14 14.4h5.2"/>

// AutomationIcon —— 循环圆环 + 实心闪电
stroke: <circle cx="12" cy="12" r="8.75"/>
fill:   <path d="M13.3 6.9 8.7 12.8h3.1l-1.3 4.7 5.1-6.1h-3.1z"/>
```

## 6. 组件化方案

新增 `src/components/icons/hipIcons.tsx`：

```tsx
import { forwardRef, type SVGProps } from 'react'

export interface HipIconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number          // 默认 16
  strokeWidth?: number   // 默认 1.75
}

function createHipIcon(name: string, stroke: string[], fill: string[]) {
  const Cmp = forwardRef<SVGSVGElement, HipIconProps>(({ size = 16, strokeWidth = 1.75, ...rest }, ref) => (
    <svg ref={ref} width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={strokeWidth}
         strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" {...rest}>
      {stroke.join('')}
      {fill.length > 0 && <g fill="currentColor" stroke="none">{fill.join('')}</g>}
    </svg>
  ))
  Cmp.displayName = name
  return Cmp
}

export const ChatsIcon = createHipIcon('ChatsIcon', [...], [...])
export const ProjectsIcon = /* … */ 6 个
```

- 与 `LucideIcon` 签名兼容：可无缝传入 `<NavItem icon={ChatsIcon} />`、`<EmptyState icon={…} />` 等任何接受 `LucideIcon` 的位置。
- 颜色全部 `currentColor` 继承，主题切换零改动。
- 附带 `hipIcons.test.tsx`：断言渲染 24×24 viewBox、`stroke-width="1.75"`、`stroke-linecap="square"`、6 个图标均无 NaN 坐标（防呆）。

## 7. 状态规范

| 状态 | 呈现 |
|---|---|
| Default | `color: text-secondary`，无底 |
| Hover | 底 `bg-state-hover` + `color: text-primary`（transition 100ms） |
| Active（导航选中） | 底 `bg-state-active` + **图标 `accent-strong`** + 计数 chip 反白 |
| Disabled | `opacity: .38` + `pointer-events: none` |

动效纪律：图标永不位移/缩放/旋转；仅 `background-color` 与 `color` 过渡（≤100ms）。
`Loader2` 旋转为既有保留项（旋转即语义）。

## 8. 通用图标替换映射（语义去重）

| 语义 | 处理 |
|---|---|
| Zap | 仅保留「自动化/快」；聊天加速场景改 `Sparkles` |
| Folder 家族 | 项目=`ProjectsIcon`、知识库=`KnowledgeIcon`、文件浏览=`FolderOpen`、目录树=`ListTree` |
| CheckSquare / ListChecks | 统一为 `TasksIcon` 家族；行内勾选仍用 `Check` |
| Settings（footer） | 换 `SlidersHorizontal`（滑块，更工具感）；齿轮保留给原生托盘场景 |
| MessageSquare 会话图标 | 全部替换为 `ChatsIcon` |

## 9. 迁移路线图

| 阶段 | 内容 | 改动文件 | 验收 |
|---|---|---|---|
| **P0** 品牌图标落地 | hipIcons.tsx + 侧栏 6 行 NavItem + footer 设置图标 | `src/components/icons/hipIcons.tsx`（新增）、`AppSidebar.tsx`、`SidebarAccountFooter.tsx`、`AppSidebar.test.tsx` | `yarn tsc && yarn test` 通过；快照更新 |
| **P1** 参数收敛 | strokeWidth 1.5/1.6/2/2.5 → 1.75（~15 处）；尺寸归位 14/16/18/20（~40 处） | 各组件文件；可选 `scripts/check-icon-params.mjs` 守卫 | 全库 grep 无越界参数 |
| **P2** 状态语义 | 导航选中态 accent 图标色 + chip 反白 | `AppSidebar.tsx`（class 已具备，仅确认）、`titlebarChrome.ts` | 视觉回归截图对比 |
| **P3** 品牌延展 | EmptyState 默认图标、新建会话空状态、欢迎页 | `EmptyState.tsx`、chat 空状态组件 | 截图验收 |

每阶段独立合入、独立回滚；P0 与 P3 互不依赖。

## 10. 回归与验收

1. `yarn tsc` —— 类型兼容（LucideIcon 签名）。
2. `yarn test` —— 单测 + 快照（注意先按 CLAUDE.md 移开 `~/.hip/config/auth.json` 避免触发付费 LLM 测试）。
3. 视觉回归：playwright 截图对比侧栏（亮/暗 × 舒适/紧凑），比对点：图标 16px 对齐中线、选中态颜色 `#7c2d12`（亮）/ `#ffcc80`（暗）。
4. 手动：切换主题/密度后图标不变形；`prefers-reduced-motion` 下无动画残留。

## 11. 相关文件

| 文件 | 内容 |
|---|---|
| `docs/design/icon-upgrade-preview.html` | 高保真预览（新旧侧栏 mockup、图标库、状态/色彩规范，自包含） |
| `src/components/icons/hipIcons.tsx` | P0 新增，品牌图标组件 |
| `src/styles/tokens.css` | 颜色/尺寸 token 权威来源（本方案不新增 token，全部复用） |
| `DESIGN.md` | 视觉风格基线（本方案是对其第 4/7/9 节的图标层细化） |
