# Hip 菜单图标系统升级 Spec（Menu Icon System）

> 配套视觉预览：`docs/examples/icon-preview.html`（浏览器直接打开；可切换 亮/暗、尺寸、描边、双色，并逐图标对比 lucide 现状 vs hip 新版）。
> 旧图标路径数据：`docs/examples/icon-data.js`（提取自 `lucide-react v0.460.0`，ISC，仅预览用）。
> 目标读者：设计评审 + 前端实现。基线：`DESIGN.md` / `src/styles/tokens.css` / `tailwind.config.js`。
>
> **实施状态：本文件为 Spec（提案稿）**，尚未进入代码实施。配套预览稿已完成。

## 1. 背景与目标

### 1.1 什么是"菜单图标"

本次改造的范围**只覆盖功能菜单入口前的图标**（不包含文件类型图标、消息状态图标、markdown 内联图标）：

| 位置 | 数量 | 现状 |
|---|---|---|
| 主侧栏导航（会话/项目/知识库/终端/任务/自动化） | 6 | `AppSidebar.tsx`，lucide 16px |
| 侧栏 footer（回收站/历史/设置） | 3 | `SidebarAccountFooter.tsx`，lucide |
| 设置导航（通用/语音/窗口/模型/…） | 11 | `settingsNav.ts`，lucide 16px |
| 右键菜单 | 23 | `context-menu/icons.tsx`，lucide 14px |
| 命令面板 / 其他菜单入口 | ~15 | lucide 混合 |

### 1.2 现状问题

1. **无品牌语言** —— 图标 100% 依赖 lucide 通用图库，与 hip 的暖橙 Flat Butt 吉祥物、`#FF9800→#c2410c/#ffb300` 品牌色零关联；同类产品的菜单能直接认出"这是 hip"，现在不能。
2. **三套不统一** —— 侧栏用 16px、右键菜单 14px、其他位置 12–18px 混用；`strokeWidth` 默认 2 与个别 1.75 并存；图标视觉重心高低不一（lucide 各图标光学大小不一致），菜单行里"图标对齐"靠肉眼凑。
3. **语义过泛** —— 任务用 `CheckSquare`、自动化用 `Zap`、连接器用 `Cable`，与竞品（Linear/Vercel/GitHub Desktop）撞图且表达力弱；"项目/代码"用 `Code2` 与代码语义（终端等）混淆。
4. **无状态表达** —— hover/active 只改底色，图标本身无任何状态层；侧栏 active 态（`bg-state-active` 中性灰底）下图标与 inactive 完全同形。
5. **无图标规范** —— 没有网格、描边、尺寸档、光学对齐规则；后续新功能（如已规划的 hook 目录、市场）继续凭空选 lucide 图标，不一致只会加剧。

### 1.3 目标

- **一个自绘图标集**：`hip-icon` 系列，与品牌一致、与扁平化 DESIGN.md 一致、覆盖全部菜单入口。
- **一套规范**：网格 / 描边 / 圆角 / 尺寸档 / 色彩 / 状态，可复用到任何新菜单。
- **一份迁移地图**：lucide → hip 全量映射表 + 分阶段迁移计划，可测、可回滚。

## 2. 设计原则（与 DESIGN.md 对齐）

1. **线条优先 Line over Fill** —— 菜单图标以 1.75px 线条为主；纯色实底仅用于状态点、小圆点、双色层的 25% 面积。
2. **暖橙唯一 Hover/Active 专属** —— 双色层（`--icon-duo`）只在"品牌位"（空状态、欢迎、active 高亮）出现；**菜单常态保持单色**，与 DESIGN.md"侧栏 active 无 accent 左条"一致。
3. **直角工具化 Sharp but Calm** —— 形状圆角 2px（同 `rounded-sm`），`stroke-linecap/join: round`；不引入 lucide 的圆润卡通感。
4. **光学一致 Optical Harmony** —— 所有图标在 24px 网格上按"视觉重量"布线（图标主体 ≤22px），16px 显示时保持同一边距与重心。
5. **克制不变色** —— 颜色只走 `currentColor` / token，禁止在组件内写死图标色。

## 3. 新图标集：hip-icon

### 3.1 命名与规格

| 项 | 规格 |
|---|---|
| 命名 | `hip-chat` / `hip-code` / `hip-knowledge` …（kebab-case，语义命名） |
| 设计网格 | 24×24（与 lucide 同源，可直接替换） |
| 描边 | `1.75px`（lucide 为 2；细 12.5% 更工具化，16px 显示仍清晰） |
| 端点 | `stroke-linecap=round`、`stroke-linejoin=round` |
| 形状圆角 | 2px（矩形/气泡圆角） |
| 安全区 | 主体不得超出 22×22（留 1px 光学余量） |
| 填充层 | 双色变体：≤25% 面积用 `--icon-duo`（亮 `#c2410c` / 暗 `#ffb300`），其余 `currentColor` |

### 3.2 双色（Duotone）规则

- **何处可用**：仅"品牌位"——空状态大图（40–64px）、欢迎页、侧栏 active（可选项）。
- **何处禁用**：菜单常态、右键菜单、工具栏、14px 以下。
- 25% 面积上限：双色元素（如自动化的闪电头、任务的勾）面积不超过图标总面积的 1/4。

### 3.3 尺寸档（Density 固定）

| 档位 | 尺寸 | 用途 |
|---|---|---|
| `--icon-xs` | 14px | 右键菜单、行内操作、chip 内 |
| `--icon-sm` | 16px | **菜单标准档**：侧栏导航、设置导航、footer |
| `--icon-md` | 20px | 工具栏、面板标签 |
| `--icon-lg` | 24px | 空状态、详情头部 |
| `--icon-hero` | 40–64px | 欢迎页、品牌位（双色） |

> 菜单一律用 `16px`。禁止 12/13/15/17/18px 等散点尺寸出现在菜单里。

### 3.4 图标总表（新 vs 旧）

**A. 主侧栏导航（6）**

| 新名 | 语义 | lucide 现状 | 设计要点 |
|---|---|---|---|
| `hip-chat` | 会话 | `MessageSquare` | 2px 圆角气泡 + 三点实心点；气泡尾缩短、重心上移 |
| `hip-code` | 项目 | `Code2` | `</>`：两个 45° 尖括号 + 中缝斜杠；比 lucide 更瘦长 |
| `hip-knowledge` | 知识库 | `BookOpen` | 摊开的书，书脊为 1px 中缝，左右页微内弧 |
| `hip-terminal` | 终端 | `Terminal` | 直角窗口 + `>_` 提示符，提示符留在左对齐 |
| `hip-tasks` | 任务 | `CheckSquare` | 左侧勾选框（勾为 45° 双折线）+ 右侧条目线 |
| `hip-automation` | 自动化 | `Zap` | 闪电；双色变体：闪电尖为 `--icon-duo` |

**B. 侧栏 footer（3）**

| 新名 | 语义 | lucide 现状 | 设计要点 |
|---|---|---|---|
| `hip-trash` | 回收站 | `Trash2` | 桶盖左翘 8°，桶身 2px 圆角，两道桶身线 |
| `hip-history` | 历史 | `History` | 圆盘 + 指针 + 左上逆时针回退箭头（弧形尾） |
| `hip-settings` | 设置 | `Settings` | 8 齿齿轮（程序化生成，齿根/齿顶双半径），中心孔 r2.2 |

**C. 设置导航（11）**

| 新名 | 语义 | lucide 现状 | 设计要点 |
|---|---|---|---|
| `hip-general` | 通用 | `SlidersHorizontal` | 三条横线 + 竖滑块（滑块 4px 高，骑在线上） |
| `hip-voice` | 语音 | `Mic` | 胶囊麦 + 半圆底座弧 + 支架 |
| `hip-window` | 窗口 | `AppWindow` | 窗口 + 标题栏 + 两个交通灯圆点 |
| `hip-model` | 模型 | `Cpu` | 芯片 + 内核方块 + 四边引脚 |
| `hip-connectors` | 连接器 | `Cable` | 插头线缆：公头→线→母头 |
| `hip-memory` | 记忆 | `Brain` | 双脑叶（沿用解剖轮廓）+ 中缝折叠线 |
| `hip-agents` | 智能体 | `Bot` | 方头 + 天线 + 双耳 + 双眼点 |
| `hip-mcp` | MCP | `Plug` | 插头本体 + 双脚 + 引线 |
| `hip-skill` | 技能 | `Sparkles` | 4 角星（中心）+ 小星 + 十字（左下） |
| `hip-plugins` | 插件 | `Package` | 立方体透视图 + 顶盖中缝 |
| `hip-hooks` | 钩子 | `Link2` | 双链环，开口相对 |

**D. 右键菜单（23）**

| 新名 | 语义 | lucide 现状 | 设计要点 |
|---|---|---|---|
| `hip-plus` | 新建 | `Plus` | 正交十字 |
| `hip-sun` / `hip-moon` | 主题 | `Sun`/`Moon` | 8 射线太阳 / 新月 |
| `hip-monitor` | 跟随系统 | `Monitor` | 显示器 + 底座 |
| `hip-palette` | 外观 | `Palette` | 调色盘 + 4 色点 |
| `hip-keyboard` | 快捷键 | `Keyboard` | 键盘 + 两行键点 + 空格条 |
| `hip-wrench` | 工具 | `Wrench` | 开口扳手 |
| `hip-git-branch` | 分支 | `GitBranch` | 3 圆 + 主干线 + 分支弧 |
| `hip-puzzle` | 拼图 | `Puzzle` | 圆角块 + 上凸卡榫 |
| `hip-book-open` / `hip-terminal` / `hip-zap` / `hip-check-square` / `hip-message-square`(=chat) / `hip-code` / `hip-history` / `hip-settings` | 复用上文 | — | 复用，不重复绘制 |

**E. 状态与通用（14px，线条）**

`hip-check`（双折线）、`hip-circle-check`、`hip-circle-x`、`hip-alert`（三角+叹号，圆角三角）、`hip-info`、`hip-ban`、`hip-loader`（270° 弧，旋转动画）、`hip-target`（三同心圆）。

**F. 待补全（沿用规范，P3 实施）**

`search`、`folder`、`folder-open`、`chevron-*`、`ellipsis-*`、`pencil`、`copy`、`refresh`、`rotate-ccw`、`download`、`external-link`、`eye/eye-off`、`lock`、`play/stop`、`mic-off`、`archive`、`inbox`、`globe`、`server`、`users`、`key-round`、`shield-check`、`git-commit`、`git-fork`、`calendar`、`layout-template`、`folder-git-2`、`list-*`、`file-*`、`terminal-square` —— 共约 35 个，全部按 §3.1 规格重绘，不进入本文档逐条设计。

## 4. 规范细节

### 4.1 网格与光学对齐

```
24×24 网格，基线如下：
├─ 22px 安全区（主体边界）
├─ 18px 光学圈（图标主视觉元素中心分布区）
└─ 描边 1.75 居中布线：奇数坐标取 .5（如 4.5、12.5），
   保证 16px 渲染时线条落在亚像素中心
```

- 圆角形状统一 2px；圆形元素（点、齿、孔）直接 `circle`。
- 对称图标（check/plus/bolt）按 45° 或 90° 轴对称，禁止手抖曲线。
- 视觉重量目标：所有图标在 16px 下"看起来一样大"（对比时以 `hip-chat` 为基准）。

### 4.2 色彩（沿用 DESIGN.md token）

| 用法 | 亮色 | 暗色 | 备注 |
|---|---|---|---|
| 菜单常态 | `currentColor`（行文字色） | 同 | 文字 `--text-primary/secondary` |
| 次级图标（时间戳行内） | `--text-tertiary` | 同 | 仅限非交互图标 |
| 双色层 `--icon-duo` | `#c2410c` | `#ffb300` | 仅品牌位（§3.2） |
| 状态图标 | `--success/--danger/--warning` | 同 | 与状态色共用，不新增 |
| 禁用 | `opacity-40`（沿用按钮规范） | 同 | 不改色 |

### 4.3 交互状态（菜单行）

| 状态 | 图标行为 |
|---|---|
| 常态 | 单色，`currentColor` |
| hover | 底色 `--state-hover`，图标不变形不变色 |
| active（选中） | 底色 `--state-active`；可选：图标 `--icon-duo`（双色开关，默认关） |
| focus | 2px accent 方形 focus ring（沿用全局） |
| 禁用 | `opacity-40` |
| 过渡 | `transition-[background-color,color] 100ms`，图标不位移、不缩放 |

## 5. 渲染层（实施建议）

```tsx
// src/components/ui/HipIcon.tsx（P1 交付物）
type HipIconName = 'chat' | 'code' | … | 'puzzle'
export function HipIcon({
  name, size = 16, duo = false, className, title,
}: {
  name: HipIconName
  size?: 14 | 16 | 20 | 24
  duo?: boolean   // 双色变体（仅品牌位）
  className?: string
  title?: string  // 提供 title 时生成 <title>，否则 aria-hidden
})
```

- 图标源：单个 `hip-icons.ts`（路径数据对象，tree-shake 友好，体积远小于 lucide 全量）。
- 默认 `aria-hidden="true"`；菜单行由行文本承担无障碍标签。
- 与 `lucide-react` **并存期**：`<HipIcon name="chat"/>` 与 `<MessageSquare/>` 可同页共存，逐模块替换。

## 6. 迁移计划（分阶段，可回滚）

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 基础设施 | 建 `hip-icons.ts` + `HipIcon` 组件 + `--icon-*` 尺寸 token；全量单测 | `yarn tsc` + `yarn test` 通过；新老图标并排视觉核对 |
| P2 主入口 | 替换 `AppSidebar` 6 导航 + footer 3 + `MainToolbar` 面板按钮 | 侧栏截图对比基线（明/暗） |
| P3 全量菜单 | 替换 `settingsNav` 11 + `context-menu/icons.tsx` 23 + 命令面板 | 右键菜单/设置页无 lucide 残留 |
| P4 收尾 | 补全 F 组 35 个；移除本模块 `lucide-react` 依赖；清理 `icon-data.js` | 全库 grep 无菜单位 lucide 残留；bundle 体积报告 |

**回滚**：每阶段单 commit，`HipIcon` 与 lucide 并存，任何阶段可单独 revert。

## 7. 验收标准（视觉核对清单）

在 `icon-preview.html` 中逐项核对：

1. [ ] 9 个主入口图标 16px 下视觉重量一致（对比行无突兀大/小）。
2. [ ] 双色仅品牌位；菜单常态全单色。
3. [ ] 亮/暗两套主题下描边清晰（1.75 在 16px 渲染无糊线）。
4. [ ] 右键菜单 14px 档无细节丢失（如齿轮齿、键盘键点仍可辨）。
5. [ ] hover/active 无位移无缩放（fade 与底色过渡）。
6. [ ] `prefers-reduced-motion` 下 loader 静止。
7. [ ] 对比度：`--icon-duo` 与两套底色均达 AA。

## 8. 相关文件

| 文件 | 内容 |
|---|---|
| `docs/icon-system-spec.md` | 本文档 |
| `docs/examples/icon-preview.html` | 视觉预览稿（新 vs 旧、明暗、尺寸/描边/双色调节） |
| `docs/examples/icon-data.js` | lucide 现状路径（提取自 node_modules，仅预览） |
| `src/components/ui/HipIcon.tsx`（P1 创建） | 渲染组件 |
| `src/lib/hip-icons.ts`（P1 创建） | 图标路径数据 |
