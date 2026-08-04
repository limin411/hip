# 代码块颜色选项配置 Spec（草案）

> 状态：**草案 · 已按评审答复更新** · 2026-08-04
> 范围：在「通用设置」新增「代码块颜色」选项；只影响代码块展示，不改应用主题与终端颜色。
> 关联现状：`src/lib/shikiLazy.ts`、`src/components/chat/CodeBlock.tsx`、`src/components/artifact/previewBodies.tsx`、`src/components/knowledge/blocks/liveCodeBlockView.ts`、`packages/protocol/src/hip-config.ts`、`src-tauri/src/hip_config.rs`、`packages/sidecar/src/config/hip-config.ts`

评审答复（2026-08-04）：Q1 命名预设 P0 不做；Q2 颜色包含代码块背景；Q3 持久化到 `hip.toml`。正文已按这三项同步更新。

## 0. 需求理解与假设

需求原文：「通用设置页面，增加对代码块的颜色选项配置」。

本文按以下理解推进：

- “代码块颜色” = **代码块整体配色**（背景 / 边框 / 文字 + 语法高亮 token），通过下拉选择方案。
- 默认行为保持现状：跟随应用主题，浅色 / 深色自动切换。
- 目标是让用户可以**独立于应用主题**固定代码块为浅色或深色；修改立即生效并持久化。

如果实际意图只是“语法高亮 token 颜色”或“自定义某个具体颜色”，见 §9 开放问题。

## 1. 现状

| 面 | 现状 |
|---|---|
| 语法高亮 | `shikiLazy.ts` 硬编码 `github-light` / `github-dark`，根据 `document.documentElement` 是否带 `dark` 切换 |
| Chat / Knowledge 代码块 | `CodeBlock.tsx` 用 `useIsDark()` 决定高亮主题；块背景、边框、文字跟随应用 token |
| 文件预览 | `previewBodies.tsx` 的 `CodePreviewBody` 同样用 `useIsDark()` |
| 知识库编辑器 | `liveCodeBlockView.ts` 的 NodeView 通过 `isDocDark()` 决定高亮，并在文档主题切换时重刷预览 |
| 应用外观偏好 | 主题 / 语言 / 密度持久化在 `uiStore` + localStorage `hip-ui` |
| 终端颜色 | 持久化在 `hip.toml [terminal]`，通用设置已有独立配色下拉 |

## 2. 建议决策（待评审）

| # | 决策点 | 建议 |
|---|--------|------|
| D1 | 范围 | 仅 fenced code block（``` 代码块），不含 inline code |
| D2 | 放置 | 通用设置页「主题」行之后（同属外观类，不新增分组） |
| D3 | P0 选项 | `follow`（跟随应用主题，默认）/ `light`（浅色）/ `dark`（深色） |
| D4 | P1 选项 | 命名预设（Dracula、One Dark、Solarized 等），P0 不做 |
| D5 | 持久化 | `hip.toml` 新增 `[code_block]` 段（protocol + Rust + sidecar 同步） |
| D6 | 生效方式 | 修改后立即生效，所有已渲染的代码块 / 文件预览 / 编辑器预览同步刷新 |
| D7 | 背景策略 | 选 `light` / `dark` 时，代码块背景 / 边框 / 文字随所选方案变化，避免与应用主题相反时对比度不足 |

### D5 理由

按评审答复，代码块颜色作为用户配置落到 `hip.toml`，与「终端颜色」保持一致：配置机器可读、可随用户配置迁移，并由 Tauri `get/set_hip_config` 统一读写。代价是需要同步 protocol 类型、Rust TOML 镜像与 sidecar 归一化，但这些改动都是既有模式的小幅复制。

## 3. UI 设计

行样式与现有「主题」「终端颜色」一致：

- 左侧：标题「代码块颜色」+ 说明「代码块整体配色，与应用主题相互独立。修改后立即生效。」
- 右侧：下拉选择，选中项带 `Check` 图标。
- 测试标识：
  - 行：`settings-code-block-color`
  - 触发器：`settings-code-block-color-trigger`
  - 选项：`settings-code-block-color-follow` / `settings-code-block-color-light` / `settings-code-block-color-dark`

选项表：

| id | 中文标签 | 效果 |
|---|---------|------|
| `follow` | 跟随应用主题 | 沿用现状：应用浅色 → GitHub Light，应用深色 → GitHub Dark |
| `light` | 浅色 | 固定 GitHub Light + 浅色代码块背景 / 边框 / 深色文字 |
| `dark` | 深色 | 固定 GitHub Dark + 深色代码块背景 / 边框 / 浅色文字 |

## 4. 配置模型

### protocol（`packages/protocol/src/hip-config.ts`）

```ts
export const CODE_BLOCK_COLOR_THEME_IDS = ['follow', 'light', 'dark'] as const
export type CodeBlockColorThemeId = (typeof CODE_BLOCK_COLOR_THEME_IDS)[number]

export function isCodeBlockColorThemeId(v: string): v is CodeBlockColorThemeId

export interface CodeBlockConfig {
  /** 代码块配色 id；缺失 / 未知 → follow。 */
  colorTheme?: CodeBlockColorThemeId
}
```

`HipConfig` 增加 `codeBlock?: CodeBlockConfig`。

### Rust（`src-tauri/src/hip_config.rs`）

- 新增 `CodeBlockConfig`（JSON camelCase：`colorTheme`）与 `TomlCodeBlockConfig`（TOML snake_case：`color_theme`，alias `colorTheme`）。
- `HipConfig` / `TomlHipConfig` 各增加 `code_block` 字段；TOML 段为 `[code_block]`，alias `[codeBlock]`。
- 补 `From` 双向转换，保证 `set_hip_config` 重写时该段不被剥离。

### sidecar（`packages/sidecar/src/config/hip-config.ts`）

- 新增 `normalizeCodeBlock(raw)`：读取 `colorTheme ?? color_theme`，trim / lowercase 后仅接受 `CODE_BLOCK_COLOR_THEME_IDS`。
- `validateConfig` 中解析 `obj.codeBlock ?? obj.code_block`。
- `deepMergeConfig` 保留项目级 `codeBlock` 整体替换（与 `agentLoop` / `acp` 同规则）。

### 前端 domain（`src/domain/knowledge/codeBlockTheme.ts`）

新增前端 domain 模块 `src/domain/knowledge/codeBlockTheme.ts`，直接复用 protocol 的 `CodeBlockColorThemeId` / `CODE_BLOCK_COLOR_THEME_IDS`（可 type alias 为 `CodeBlockThemeId`），不重复定义值列表：

```ts
export function normalizeCodeBlockThemeId(raw: string | undefined | null): CodeBlockThemeId
export function resolveShikiTheme(
  themeId: CodeBlockThemeId,
  isDark: boolean,
): 'github-light' | 'github-dark'
```

并导出 P0 两个固定方案的代码块 chrome 色板（背景、边框、头部、文字色），供 `CodeBlock`、文件预览、Live NodeView 统一使用。

前端统一用 `normalizeCodeBlockThemeId` 回退 `follow`。

## 5. 渲染接线

### `shikiLazy.ts`

`highlightCode` 签名从 `(code, lang, isDark)` 改为 `(code, lang, themeId, isDark)`：

- `follow` → `isDark ? github-dark : github-light`
- `light` → `github-light`
- `dark` → `github-dark`
- 缓存 key 使用最终解析出的 Shiki theme 名，保证同一代码不同方案互不串缓存。

### `CodeBlock.tsx` / `CodePreviewBody`

- 通过 `useHipConfigStore((s) => normalizeCodeBlockThemeId(s.config.codeBlock?.colorTheme))` 读取偏好。
- `themeId !== 'follow'` 时，宿主容器 / 头部 / `pre` 应用对应 chrome 色板（背景、边框、文字）。
- 高亮 effect 依赖中加入 `codeBlockTheme`，切换后已渲染的块自动重新高亮。
- 文件预览同样读取偏好并传入 `highlightCode`，按所选方案应用背景与文字色。

### 知识库编辑器 `LiveCodeBlockNodeView`

- 构造时读取 `useHipConfigStore.getState()` 中的 `codeBlock?.colorTheme`（归一化后）。
- 订阅 `useHipConfigStore` 的 `codeBlock` 变化，触发 `refreshPreview()`，并同步更新预览 / 编辑区域 chrome 色板。
- 保留现有文档明暗订阅（`follow` 仍需响应系统 / 应用主题切换）。

### `GeneralSettings.tsx` + i18n

- 在「主题」行后新增与终端颜色同构的下拉行；读取 `useHipConfigStore` 的 `codeBlock.colorTheme`，选择时 `updateSection('codeBlock', (prev) => ({ ...(prev ?? {}), colorTheme }))`。
- 新增 i18n keys（五种语言）：`settings.codeBlockColor`、`settings.codeBlockColorDesc`、`settings.codeBlockColors.{follow,light,dark}`。

## 6. 验收标准

1. 通用设置出现「代码块颜色」，默认显示「跟随应用主题」。
2. 选择「浅色」后，Chat / Knowledge 代码块、文件代码预览、知识库编辑器预览立即变为浅色方案；重启后保持。
3. 选择「深色」后同理；应用主题无论明暗，代码块都保持所选方案且可读。
4. 选择「跟随应用主题」恢复现状：应用明暗切换时代码块同步切换。
5. 未知 `hip.toml` 值（手改 / 旧版本）被归一化为 `follow`。
6. 新增/更新的测试覆盖：protocol contract、Rust TOML 往返、sidecar 归一化、`normalizeCodeBlockThemeId`、Shiki 映射、通用设置行交互、`CodeBlock` 传参。

## 7. 备选方案

### A. 持久化到 `hip.toml [code_block]`

- 优点：配置随 `hip.toml` 存在，机器可读、可随用户配置迁移。
- 缺点：需要改 protocol 类型、Rust TOML 镜像与 From 转换、sidecar 归一化、contract 测试；对纯前端外观偏好偏重。
- 结论：**采用（评审 Q3）**；正文按此方案编写。

### B. 持久化到 `uiStore` + localStorage

- 优点：只动前端，改动最小。
- 缺点：与「终端颜色」的持久化位置不一致，且配置不能随 `hip.toml` 迁移。
- 结论：不采用（评审 Q3）。

### C. 只改语法高亮、不动代码块背景

- 优点：实现更小（只改 `shikiLazy` 与传参）。
- 缺点：应用深色 + 代码块浅色时，GitHub Light 的深色 token 会落在深色块背景上，对比度不可接受；与“独立配色”的产品语义冲突。
- 结论：不采用；背景必须随方案一起变（评审 Q2）。

### D. P0 就带命名预设

- 优点：与「终端颜色」的预设能力对齐。
- 缺点：需要加载更多 Shiki theme 包、维护预设标签与色板，首版范围变大。
- 结论：P1 再扩展；`CODE_BLOCK_COLOR_THEME_IDS` 与 i18n 结构已预留扩展位。

## 8. 非目标

- 不提供自定义背景 / 边框 / 文字色（颜色选择器）。
- 不提供逐 token 颜色编辑。
- 不改变 inline code、终端颜色、应用主题。
- 不支持 per-fence 覆盖（例如 ```ts theme=... 元数据）。
- 不改变 `follow` 的现有渲染样式；`follow` 即现状。

## 9. 评审结论（原开放问题）

- Q1：【已答：否】P0 不包含命名预设，P1 再做。
- Q2：【已答：包含】“颜色”包含代码块背景，正文 D7 已落实。
- Q3：【已答：`hip.toml`】正文已按 `[code_block]` 方案重写 D5、§4、§5、§6、§7。
