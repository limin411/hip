# 视觉语言升级：色彩体系、圆角、密度、动画

**日期：** 2026-06-10  
**状态：** 已确认  
**范围：** `tokens.css`、`tailwind.config.js` 设计 token 重构 + 全局组件视觉规整 + 关键组件视觉重设计  
**关联：** 在 [`2026-06-06-flat-shell-ui-redesign-design.md`](./2026-06-06-flat-shell-ui-redesign-design.md) 统一平面外壳基础上做视觉层升级

---

## 1. 目标

将 hip 从当前的**极简单色扁平**（accent `#111`、全 0 圆角、12px 紧凑排版、无动画）升级为**现代扁平**视觉语言，对标 Linear、Claude、Cursor 级产品质感。

不改变布局结构、不改变功能逻辑、不引入暗色模式。仅做视觉层升级。

---

## 2. 背景与问题诊断

通过与 Linear / Claude / Cursor / Codex CLI 的竞品对比，确认 hip 在以下维度落后：

| 维度 | hip 当前 | 竞品共识 |
|------|---------|---------|
| 强调色 | `#111` 纯黑（单色） | 均有品牌强调色 |
| 暗色模式 | 无 | 4/4 支持 |
| 圆角 | 全部 0 | 3~8px 为主流 |
| 字号层次 | 10~14px 单调 | 3~4 级字号系统 |
| 行距/间距 | 紧凑（1.5 / 8px） | 宽松（1.6~1.8 / 12~16px） |
| 过渡动画 | 几乎无 | hover/focus 过渡 + 面板缓动 |

用户选定 3 个优先升级项：微圆角 + 呼吸感、升级色彩系统、补全过渡动画。暗色模式本次不做，但 token 结构预留扩展能力。

---

## 3. 设计决策

### 3.1 品牌强调色：Teal `#0d9488`

替代 `#111` 作为 `--accent`。Teal 介于蓝绿之间，冷静有活力，未被开发者工具过度使用，品牌辨识度强。

选择过程：对比了 Indigo（Linear 风）、Amber（Claude 风）、Teal、保留单色 4 个方向。用户选择 Teal。

### 3.2 圆角体系：4~8px 分场景

全场从 `0` 升级到分场景圆角：

| 元素 | 圆角 | Tailwind 映射 |
|------|------|-------------|
| 按钮 | 6px | `rounded-md` |
| 输入框 | 6px | `rounded-md` |
| 卡片/面板 | 8px | `rounded-lg` |
| 下拉/右键菜单项 | 6px | `rounded-md` |
| Badge/Avatar | 9999px | `rounded-full` |
| 面板区域 | 0 | `rounded-none`（保持平面外壳） |

选择过程：对比了 2~4px（微妙）、4~8px（适中）、8~16px（宽厚）3 档。用户选择适中档。

### 3.3 密度与字体：标准舒适

| 参数 | 当前 | 新值 |
|------|------|------|
| 正文字号 | 12px | **13px** |
| 行高 | 1.5 | **1.7** |
| 卡片内边距 | 8px | **12px** |
| 卡片间距 | 6px | **10px** |
| 一级标题 | 13px | **14px** |
| 二级标题 | - | **16px**（新增） |

选择过程：对比了紧凑（当前）、标准舒适、更宽松 3 档。用户选择标准舒适档。

### 3.4 动画体系：标准级

| 类别 | 内容 | 实现方式 |
|------|------|---------|
| 交互过渡 | hover/focus 颜色、opacity 变化 | `transition-colors` / `transition-opacity` 150ms |
| 面板动画 | 侧边栏 peek 滑入/滑出、ArtifactPanel 展开 | `transition-transform` 200ms ease-out |
| 消息动画 | 新消息淡入 + 上移 | CSS `@keyframes`，staggered |
| 滚动 | 平滑滚动、scroll-to-bottom | `scroll-behavior: smooth` |
| 加载态 | Skeleton 脉冲、spinner 旋转（已有） | `animate-pulse` / `animate-spin` |

不引入 framer-motion 等动画库。全部基于 Tailwind 内置 + 少量自定义 keyframes。

### 3.5 不做的

- **暗色模式**：本次不在 scope。但 CSS 变量命名保持语义化（`--bg-app` 而非 `--bg-light`），后续可直接追加 `[data-theme="dark"]` 变量集。
- **布局重构**：不改动 `AppLayout` 三栏结构。
- **组件 API 变更**：不改变任何组件的 props 接口。

---

## 4. 实施范围

### 4.1 阶段一：Design Token 重构

**文件：** `src/styles/tokens.css`、`tailwind.config.js`

1. 将 `--accent` 从 `#111` 改为 `#0d9488`
2. 新增 `--accent-hover`：`#0f766e`（Teal-700）
3. 新增 `--accent-subtle`：`#e6f7f5`（Teal-50 浅底）
4. 将 `borderRadius` 从全部 `0` 改为：
   - `DEFAULT` / `sm` / `md`: `6px`
   - `lg`: `8px`
   - `xl` / `2xl`: `12px`
   - `full`: 保持 `9999px`
5. 将 boxShadow 保持 `none`（继续扁平，不用阴影）
6. 更新 `fontSize` base 从 `14px` → `13px`
7. 更新 `lineHeight` base 从 `1.6` → `1.7`
8. 将 `transitionDuration` 全局默认设为 `150ms`

### 4.2 阶段二：全局组件规整

审计并修复所有组件中硬编码的值：

1. **颜色硬编码**：搜索 `#111`、`#000`、`black` 等硬编码色值，替换为语义 token（`text-ink`、`bg-accent`、`text-accent`）
2. **圆角硬编码**：搜索 `rounded-none`、`rounded-0`，按场景替换为语义 round
3. **间距硬编码**：搜索 `p-2`、`gap-2`（8px）等紧凑 spacing，统一提升到 `p-3`（12px）、`gap-2.5`（10px）
4. **过渡缺失**：所有交互元素（按钮、链接、列表项、菜单项）补 `transition-colors` 或 `transition-opacity`

### 4.3 阶段三：关键组件重设计

以下组件在新视觉语言下有显著变化：

1. **Button**（`src/components/ui/Button.tsx`）
   - 主按钮底色 `bg-accent` → Teal，hover `bg-accent-hover`
   - Ghost 按钮 hover 底从 `bg-surface-muted` → `bg-accent-subtle`

2. **Composer**（`src/components/chat/Composer.tsx`）
   - 焦点环从纯黑 → Teal 半透明（`ring-accent/30`）
   - 发送按钮底色 Teal，圆角圆形

3. **ChatPane**（`src/components/chat/ChatPane.tsx`）
   - 消息气泡间距 `gap-6` → `gap-10`
   - 新增消息入场动画 keyframes

4. **Sidebar**（`src/components/sidebar/`）
   - 激活项底色 `bg-accent-subtle`（Teal 浅底）+ 文字 `text-accent`
   - 列表项 hover `bg-accent-subtle`
   - Peek 滑入动画已有 `transition-transform`，确保 duration 200ms

5. **ArtifactPanel**（`src/components/artifact/ArtifactPanel.tsx`）
   - Tab 激活指示条从纯黑 → Teal
   - 文件树选中项 `bg-accent-subtle text-accent`

6. **Modal / DropdownMenu / ContextMenu**
   - 浮层面板 `border-border` → 保持，无需阴影

### 4.4 动画关键帧

新增 CSS keyframes：
```css
@keyframes message-enter {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

---

## 5. 实施顺序

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | 修改 `tokens.css` 颜色、字号、行高变量 | - |
| 2 | 修改 `tailwind.config.js` 圆角、duration、fontSize | - |
| 3 | 全局搜索替换硬编码色值 | 1 |
| 4 | 全局搜索替换硬编码圆角/间距 | 2 |
| 5 | 为交互元素补 transition 类 | 3,4 |
| 6 | 添加消息入场动画 keyframes | - |
| 7 | 逐个组件验证视觉一致性 | 5,6 |

---

## 6. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 色值全局替换可能误伤外部资源（如第三方 iframe 中的 `#111`） | 只替换 `src/` 下 `.tsx`/`.css` 文件 |
| 圆角变更导致某些卡片区域视觉溢出 | 相同 padding 下 8px 圆角极小，实测不会溢出 |
| 间距提升可能导致面板内容截断 | 每改完一个组件即本地验证 |
