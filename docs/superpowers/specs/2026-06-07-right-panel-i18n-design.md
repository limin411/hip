# 右侧面板行为修复 + 国际化支持设计文档

日期：2026-06-07

## 背景

hip 项目是一个基于 Tauri v2 + React 的桌面应用，使用 react-resizable-panels 实现三栏布局。当前存在两个问题：

1. **右侧面板自动打开**：应用启动时，尽管 `uiStore` 中 `panelOpen` 初始值为 `false`，右侧面板仍会自动展开。经排查，这是 `react-resizable-panels` 库在组件首次挂载时触发 `onExpand` 回调导致的。
2. **缺少国际化支持**：当前所有 UI 文本均为硬编码中文，设置面板中的语言选择 UI 仅为静态展示，无实际切换功能。

## 需求

### 需求 1：右侧面板不自动打开
- 应用启动时右侧面板应保持关闭状态
- 用户通过主动操作（点击 ChatHeader 的切换按钮、拖拽展开等）才能打开面板
- 不影响拖拽、折叠/展开等正常交互

### 需求 2：国际化（i18n）
- 支持三种语言：**简体中文（zh-CN）、繁体中文（zh-TW）、英文（en）**
- 整个应用所有 UI 文本均需支持实时切换
- 在设置面板中提供语言选择 UI，切换后即时生效
- 用户选择的语言应持久化存储（localStorage）

## 技术方案

### 方案 1：右侧面板修复（推荐：Ref 标志位）

**根因**：`react-resizable-panels` 的 `Panel` 组件在首次挂载时，若 `defaultSize > collapsedSize`，会自动触发 `onExpand` 回调。

**解决方案**：在 `AppLayout.tsx` 中使用 `useRef` 创建一个标志位 `hasInitializedPanel`，在 `onExpand` 回调中检查该标志：

- 首次触发（`hasInitializedPanel.current === false`）：跳过 `setPanelOpen(true)`，仅将标志设为 `true`
- 后续触发（用户拖拽或点击展开）：正常调用 `setPanelOpen(true)`

**代码示例**：

```tsx
const hasInitializedPanel = useRef(false)

<Panel
  onExpand={() => {
    if (!hasInitializedPanel.current) {
      hasInitializedPanel.current = true
      return
    }
    setPanelOpen(true)
  }}
  onCollapse={() => setPanelOpen(false)}
>
```

**优点**：
- 改动最小（约 3-5 行代码）
- 不影响拖拽和手动展开功能
- 无需修改库或复杂状态管理

**缺点**：
- 略依赖库的实现细节（首次挂载触发回调）

### 方案 2：国际化实现（推荐：i18next + react-i18next）

**架构**：

```
src/
├── i18n/
│   ├── index.ts          # i18next 初始化配置
│   ├── zh-CN.ts          # 简体中文翻译
│   ├── zh-TW.ts          # 繁体中文翻译
│   └── en.ts             # 英文翻译
```

**实现步骤**：

1. **安装依赖**：`i18next`, `react-i18next`, `i18next-browser-languagedetector`
2. **创建翻译文件**：提取所有硬编码中文文本到翻译对象中
3. **初始化 i18next**：在 `src/i18n/index.ts` 中配置，使用 `localStorage` 持久化用户选择
4. **在 `main.tsx` 中导入**：确保在应用渲染前初始化 i18n
5. **在 `SettingsPanel` 中实现切换**：提供语言选择 UI，调用 `i18n.changeLanguage()`
6. **替换所有硬编码文本**：使用 `useTranslation` hook 或 `<Trans>` 组件

**关键设计决策**：

- **翻译键命名**：采用扁平结构（如 `'settings.language'`、`'chat.sendButton'`），便于维护和搜索
- **语言检测顺序**：`localStorage > 浏览器语言 > 默认（zh-CN）`
- **持久化**：用户选择存储在 `localStorage` 的 `i18nextLng` 键中（i18next 默认行为）

**不采用自定义方案的原因**：
- i18next 是行业标准，支持插值、复数、嵌套等高级功能
- 生态丰富，未来如需更多语言或功能（如 ICU 格式）易于扩展
- 依赖体积仅约 20-30KB，对桌面应用可接受

## 实施范围

### 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `src/routes/AppLayout.tsx` | 添加 `hasInitializedPanel` ref，修改 `onExpand` 回调 |
| `src/store/uiStore.ts` | 确认初始状态（无需修改，仅验证） |
| `src/store/uiStore.test.ts` | 确认测试覆盖（可能需要更新） |
| `package.json` | 添加 `i18next`, `react-i18next`, `i18next-browser-languagedetector` |
| `src/main.tsx` | 导入 i18n 初始化 |
| `src/components/account/SettingsPanel.tsx` | 实现语言选择 UI 和切换逻辑 |
| `src/i18n/index.ts` | 新建：i18next 配置 |
| `src/i18n/zh-CN.ts` | 新建：简体中文翻译 |
| `src/i18n/zh-TW.ts` | 新建：繁体中文翻译 |
| `src/i18n/en.ts` | 新建：英文翻译 |
| **所有包含硬编码中文的组件** | 替换为 `useTranslation` |

### 已知需要替换文本的组件（部分）

- `src/components/account/SettingsPanel.tsx` — 设置项标签
- `src/components/sidebar/UserMenu.tsx` — 菜单项
- `src/components/chat/ChatHeader.tsx` — 按钮标题
- `src/components/artifact/ArtifactPanel.tsx` — Tab 标签（doc/files/agents/diff）
- `src/routes/AppLayout.tsx` — 可能的布局相关文本

## 测试计划

1. **单元测试**：
   - 验证 `uiStore` 初始状态 `panelOpen` 为 `false`
   - 验证 `onExpand` 首次触发不改变状态
   - 验证 i18n 语言切换后文本正确更新

2. **E2E 测试**：
   - 应用启动时右侧面板处于关闭状态
   - 点击 ChatHeader 切换按钮可展开/折叠右侧面板
   - 拖拽右侧面板边缘可展开/折叠
   - 在设置中切换语言后，所有界面文本即时更新

## 风险与回滚

| 风险 | 缓解措施 |
|------|----------|
| i18n 依赖引入导致构建问题 | 使用 `yarn add` 安装后，先本地构建验证 |
| 翻译文本遗漏 | 使用 ESLint 规则或正则搜索确保无硬编码中文 |
| `react-resizable-panels` 版本升级后行为变化 | 记录此修复逻辑在代码注释中，升级时复核 |

## 验收标准

- [ ] 应用启动时右侧面板默认关闭
- [ ] 用户可通过点击按钮或拖拽主动展开右侧面板
- [ ] 设置面板提供三种语言选择
- [ ] 切换语言后，整个应用 UI 文本即时更新
- [ ] 语言选择持久化，重启应用后保持上次选择
- [ ] 所有现有测试通过
