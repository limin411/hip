# 中性 CTA 按钮体系 · 去掉「绿底白字」

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-11 |
| 状态 | **已实现**（P0–P1；MessageBubble/ThinkingBubble 身份 chip 仍用 accent 填充，见 Non-Goals / follow-up） |
| 后续 | primary 形态被 **Cursor 化升级** 覆盖：见 [`2026-07-11-button-cursor-inspired-design.md`](./2026-07-11-button-cursor-inspired-design.md)（solid inverse；仍禁止绿底 CTA） |
| 类型 | 设计系统原语变更 + 全页扫尾（不扩产品面） |
| 参照 | 登录页右侧 **方案 D**（`AuthButton` elevated stack） |
| 前置 | `2026-07-11-visual-design-style-architecture` 已落地；`Button` + `buttonVariants` 为唯一按钮真相源 |
| 实施清单 | [`../plans/2026-07-11-button-neutral-cta.md`](../plans/2026-07-11-button-neutral-cta.md) |

---

## 1. 问题陈述

当前全局 `Button` 的 `primary` 为：

```txt
bg-accent text-on-accent hover:bg-accent-hover
```

即 **鼠尾草绿实心底 + on-accent 字**（亮色下接近白字）。登录页右侧已改用中性 elevated 栈，产品内其余 CTA（发送、保存、添加、批准…）仍是绿底，视觉分裂且与「克制单色 chrome」方向冲突。

目标：所有 **按钮型 CTA** 不再使用「绿底 + 浅色字」；主操作与登录页一致——**深描边白/表面底 + 深字**，次级为浅灰底轻边框。

---

## 2. Goals / Non-Goals

### Goals

| ID | 目标 |
|----|------|
| B1 | **原语一次改对**：`buttonVariants.primary` / 次级层级对齐登录 D，全库 `<Button>` 默认与显式 primary 同步生效 |
| B2 | **登录不再双轨**：`AuthButton` 消费 `buttonVariants`（或同一 token 类名），禁止登录专用 class 与全局 primary 分叉 |
| B3 | **手写绿底 CTA 清零**：凡可点击控件使用 `bg-accent` + `text-on-accent`（或等价绿底浅字）的按钮/开关，改为中性 elevated 或 outline 选中态 |
| B4 | **亮暗对称**：中性 primary 在 light/dark 均可读；不依赖「永远白字」 |
| B5 | **门禁**：rg 扫尾规则 + 组件测试断言 primary 不含 `bg-accent` 填充分案 |
| B6 | **布局与文案冻结**：只改 class / 原语；不改按钮文案、流程、信息架构 |

### Non-Goals

| ID | 非目标 |
|----|--------|
| N1 | 去掉品牌色本身：列表选中、resize 高亮、subtle badge、`text-accent` 链接、activity 圆点等 **非「绿底白字按钮」** 可保留 |
| N2 | 改 `danger` 实心红（语义危险操作保留填充） |
| N3 | 重做 Avatar 渐变、角色色、diff 状态色 |
| N4 | 引入第二套主题编辑器 / 用户自定义 CTA 色 |
| N5 | 为本次单独换字体、加全局 elevation 系统 |

---

## 3. 设计规范（钉死）

### 3.1 登录页 D → 全局 token 映射

| 角色 | 登录页现状（AuthButton） | 全局 `buttonVariants` 目标 |
|------|--------------------------|----------------------------|
| **Primary CTA** | `border border-ink bg-surface text-ink font-semibold` + 轻阴影 + `hover:bg-surface-subtle` | `primary` |
| **Secondary / 并列操作** | `border border-border bg-[#fafafa] text-ink` + `hover:bg-surface-subtle`（暗色 `bg-surface-subtle`） | `secondary`（调整）与/或保持 `outline` 语义接近 |
| **Ghost** | （登录未用） | 保持文字按钮；hover 中性 `state-hover`，不依赖绿底 |
| **Danger** | — | **不变**：`bg-danger text-on-accent` |
| **Focus** | `ring-ink/20` | `focus-visible:ring-ink/25` 或保留 `focus-ring` 但 **填充不再用 accent 底** |

硬规则：

1. **禁止** 任何 `button` / `Button` / 明显 CTA 使用 `bg-accent` + `text-on-accent`（或 `text-white`）组合。
2. Primary **层级**靠描边与字重，不靠品牌填充。
3. Sage Gray 仅用于：**选中条、细描边强调、图标/文字 accent、subtle 底**，不作主按钮油漆。

### 3.2 建议的 `buttonVariants` 目标 class（实现可微调，语义不可改）

```txt
primary:
  border border-ink bg-surface text-ink font-semibold
  shadow-[0_1px_2px_rgba(0,0,0,0.06)]
  hover:bg-surface-subtle
  dark: 同 token（ink/surface 已反相）

secondary:
  border border-border bg-surface-subtle text-ink
  hover:bg-surface-muted
  （替代当前偏「灰底无边」且与 primary 抢眼的形态；与登录次级对齐）

outline:
  border border-border bg-surface text-ink
  hover:bg-surface-muted
  （与 secondary 可合并或保留细微差别：outline 更白、secondary 略灰）

ghost:  维持；hover:bg-state-hover
danger: 维持
```

> 实现时若 `primary` 与现有 `outline` 过近：primary = **深描边 + semibold + 轻阴影**；outline/secondary = **浅描边 + regular**。

### 3.3 默认 variant

`defaultVariants.variant` 仍为 `primary`。改原语后，所有未写 `variant` 的 `<Button>`（保存 Key、Init Git、Install…）自动变中性，无需逐个改 prop。

---

## 4. 影响面清单（盘点）

### 4.1 自动覆盖（改 `Button.tsx` 即生效）

凡使用 `<Button>` / `variant="primary"` / 默认 primary 的调用点，包括但不限于：

| 区域 | 文件 | 典型 CTA |
|------|------|----------|
| Chat | `Composer.tsx` | 发送 |
| Chat | `ChatPane.tsx` | 主操作 primary |
| Chat | `PlanApprovalCard.tsx` | 批准/执行类 primary |
| Chat | `PermissionModal.tsx` | 默认/显式按钮 |
| Account | `AgentToolbar.tsx` | 添加 Agent |
| Account | `AgentEditor.tsx` | 保存 |
| Account | `AddProviderDialog.tsx` | 添加 |
| Account | `ProviderDetail.tsx` | 保存 Key 等 |
| Account | `McpConfig.tsx` | 保存 MCP |
| Account | `PluginConfigView.tsx` | 安装入口 |
| Account | `SkillConfig.tsx` | 上传等默认 primary |
| Artifact | `FileTree.tsx` | 选择文件夹 |
| Artifact | `GitInitBanner.tsx` / `ChangesView.tsx` | git init |
| Artifact | `TerminalView.tsx` | primary |
| Artifact | `PreviewPanel.tsx` / `ArtifactPanel.tsx` | 视具体 variant |
| History | 各 Dialog 的 non-danger 确认（若用 primary） |

### 4.2 手写「绿底 + 浅字」交互控件（需单点改）

| 文件 | 模式 | 建议 |
|------|------|------|
| `ProviderDetail.tsx` | capability toggle：`bg-accent text-on-accent` | 选中 → `border-ink bg-surface text-ink` 或 `bg-surface-muted border-ink` |
| `McpConfig.tsx` | 单选圆点：`bg-accent text-on-accent` | 选中 → 中性填充或 ink 描边实心点（非绿） |
| `AuthButton.tsx` | 已是 D | 改为消费 `buttonVariants`，删除重复 class |

### 4.3 明确 **不在本次** 改动的 accent 用法（非按钮油漆）

| 类型 | 示例 | 理由 |
|------|------|------|
| Subtle 选中底 | `bg-accent-subtle` / `bg-accent-active` + `text-accent-strong` | 无「绿底白字」 |
| 透明强调 | `bg-accent/10`、`bg-accent/15` + `text-accent` | 轻量标记 |
| 装饰点 | `ActivityBar` pulse `bg-accent` | 非按钮 |
| Resize 高亮 | `group-hover:bg-accent` | 1px 手柄 |
| Avatar / 气泡角标 | `MessageBubble` / `ThinkingBubble` `bg-accent text-on-accent` | 身份 chip；可选 follow-up |
| Danger 按钮 | `variant="danger"` | 语义保留 |
| Badge 可选 accent-subtle | 分类标签 | 非 CTA |

若产品后续要求 **一切** 圆形/chip 也不用 accent 填充，单开 follow-up spec。

---

## 5. 页面级验收矩阵

| 页面 / 表面 | 关键 CTA | 验收 |
|-------------|----------|------|
| 登录 | Email / GitHub / Google | 已符合 D；与全局 primary 视觉一致 |
| 主对话 | 发送、附件旁操作 | 无绿底白字 |
| Plan / Permission | 批准、允许 | primary 中性；danger 仍可红 |
| 设置 · Agent | 添加、保存、删除 | 添加/保存中性；删除 danger |
| 设置 · Provider / MCP / Plugin / Skill | 保存、安装、测试 | 同上 |
| Code 面板 | 选文件夹、Git init、Terminal | 中性 primary |
| History | 删除确认 | danger 保持 |
| Command palette | 行选中 | 可用 subtle，非绿底按钮 |

**目视**：light + dark 各扫一遍上述表面。

---

## 6. 架构与单一真相源

```
src/components/ui/Button.tsx     ← primary/secondary/outline 唯一定义
src/components/login/AuthButton  ← 组合 Button / buttonVariants，无平行色
业务组件                           ← 只选 variant，不写 bg-accent 填充分案
tests + rg 门禁                    ← 防回归
```

禁止：

- 业务再写 `bg-accent text-on-accent` / `bg-accent text-white` 作为按钮
- 登录与全局两套 primary 语义

---

## 7. 测试与门禁

1. **单元**：`Button` 测试 — `variant=primary` class 含 `border-ink`/`bg-surface`，**不含** `bg-accent`。
2. **AuthButton**：仍断言非 `bg-accent`；可断言与 `buttonVariants({ variant: 'primary' })` 同源或共享 class 片段。
3. **回归 rg**（CI 或 plan 末手工）：

```bash
# 按钮相关绿底浅字（允许 danger / 白名单路径注释）
rg -n "bg-accent\s+.*text-on-accent|text-on-accent.*bg-accent|bg-accent text-white" src \
  --glob '!**/tokens.css'
```

白名单（若仍命中）：`Avatar` 渐变、`MessageBubble`/`ThinkingBubble` chip（标注 follow-up 前）、`Button.tsx` danger 的 `text-on-accent`（配 `bg-danger`）。

4. **命令**：`yarn vitest run src/components/ui src/components/login`；相关 dialog/composer 测试若有 snapshot/class 断言则更新。

---

## 8. 风险与回滚

| 风险 | 缓解 |
|------|------|
| Primary 与 outline 过像，主操作不突出 | 保留 semibold + `border-ink` + 轻阴影；次级用浅灰底 |
| 暗色下 ink 描边过亮 | 用 token `border-ink`，暗色已是浅线；必要时 primary 用 `border-ink` + 略加重 shadow |
| 用户短期「找不到绿色主按钮」 | 预期内；文档与 PR 说明为有意品牌收敛 |
| 漏网手写按钮 | Phase 2 rg 扫尾 |

回滚：还原 `Button.tsx` variants + 手写点即可；无数据迁移。

---

## 9. 分阶段策略

| Phase | 内容 | 可独立合并 |
|-------|------|------------|
| **P0** | 改 `buttonVariants` + Button 测试 + AuthButton 收敛 | ✅ 主收益 |
| **P1** | 手写绿底交互控件（ProviderDetail caps、Mcp 选中点等） | ✅ |
| **P2** | rg 全库扫尾、更新本 spec 状态、可选 chip follow-up 列表 | ✅ |

不要求单 PR 做完；**P0 单独合并即消除绝大多数绿底 CTA**。

---

## 10. 与既有视觉架构 spec 的关系

- **不撤销** Sage Gray 作为品牌强调色。
- **修正** 前序 spec 中「primary = accent 填充 + on-accent 字」的 CTA 约定：on-accent **仅保留给** danger（及明确非按钮的可选 chip）。
- 布局冻结、扁平 chrome、浮层阴影规则不变。
