# 右侧面板行为修复 + 国际化支持实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复右侧面板启动时自动打开的问题，并为应用添加完整的国际化支持（简体中文、繁体中文、英文）。

**Architecture:** 使用 ref 标志位阻止 react-resizable-panels 首次挂载时的 onExpand 回调误触发；使用 i18next + react-i18next 实现国际化，翻译文本集中管理在 `src/i18n/` 目录。

**Tech Stack:** React 18, TypeScript, i18next, react-i18next, i18next-browser-languagedetector, Zustand, react-resizable-panels

---

## 文件结构

```
src/
├── i18n/
│   ├── index.ts          # i18next 初始化配置
│   ├── zh-CN.ts          # 简体中文翻译
│   ├── zh-TW.ts          # 繁体中文翻译
│   └── en.ts             # 英文翻译
├── routes/
│   └── AppLayout.tsx     # 右侧面板修复
├── components/
│   ├── account/
│   │   └── SettingsPanel.tsx    # 语言选择 UI
│   ├── artifact/
│   │   └── ArtifactPanel.tsx    # Tab 标签国际化
│   ├── chat/
│   │   ├── ChatHeader.tsx       # 按钮标题国际化
│   │   ├── ChatPane.tsx         # 空状态文本国际化
│   │   ├── InputBar.tsx         # placeholder 国际化
│   │   └── MessageBubble.tsx    # 角色名称国际化
│   ├── sidebar/
│   │   ├── UserMenu.tsx         # 菜单项国际化
│   │   ├── Sidebar.tsx          # 折叠按钮国际化
│   │   ├── SidebarPeek.tsx      # 固定按钮国际化
│   │   ├── SessionItem.tsx      # 删除按钮国际化
│   │   ├── SessionList.tsx      # 空状态国际化
│   │   ├── NewChatButton.tsx    # 按钮文本国际化
│   │   └── SearchBox.tsx        # placeholder 国际化
│   ├── artifact/
│   │   ├── DocRenderer.tsx      # 空状态国际化
│   │   ├── DiffViewer.tsx       # 空状态国际化
│   │   ├── FileTree.tsx         # 空状态国际化
│   │   └── AgentDashboard.tsx   # 状态文本国际化
│   └── ui/
│       └── Modal.tsx            # 关闭按钮国际化
├── routes/
│   └── LoginScreen.tsx          # 登录页国际化
└── main.tsx                     # 导入 i18n
```

---

## Task 1: 修复右侧面板自动打开

**Files:**
- Modify: `src/routes/AppLayout.tsx:82-91`

**根因**: `react-resizable-panels` 在 Panel 组件首次挂载时，若 `defaultSize > collapsedSize`，会自动触发 `onExpand` 回调，导致 `panelOpen` 被意外设为 `true`。

- [ ] **Step 1: 添加初始化标志位**

在 `AppLayout` 组件中添加 `useRef`：

```tsx
export function AppLayout() {
  const sidebarRef = useRef<ImperativePanelHandle>(null)
  const panelRef = useRef<ImperativePanelHandle>(null)
  const hasInitializedPanel = useRef(false)  // ← 添加此行
  // ...
}
```

- [ ] **Step 2: 修改 onExpand 回调**

将右侧面板的 `onExpand` 回调改为：

```tsx
<Panel
  ref={panelRef}
  defaultSize={26}
  minSize={18}
  maxSize={65}
  collapsible
  collapsedSize={0}
  onCollapse={() => setPanelOpen(false)}
  onExpand={() => {
    if (!hasInitializedPanel.current) {
      hasInitializedPanel.current = true
      return
    }
    setPanelOpen(true)
  }}
>
```

- [ ] **Step 3: 验证修复**

启动应用，确认右侧面板默认关闭，点击 ChatHeader 的切换按钮可正常展开/折叠。

- [ ] **Step 4: Commit**

```bash
git add src/routes/AppLayout.tsx
git commit -m "fix: prevent right panel from auto-opening on app launch"
```

---

## Task 2: 安装 i18n 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装依赖**

```bash
yarn add i18next react-i18next i18next-browser-languagedetector
```

- [ ] **Step 2: 验证安装**

检查 `package.json` 确认依赖已添加，运行 `yarn type-check` 确保无类型错误。

- [ ] **Step 3: Commit**

```bash
git add package.json yarn.lock
git commit -m "deps: add i18next, react-i18next, i18next-browser-languagedetector"
```

---

## Task 3: 创建 i18n 配置和翻译文件

**Files:**
- Create: `src/i18n/index.ts`
- Create: `src/i18n/zh-CN.ts`
- Create: `src/i18n/zh-TW.ts`
- Create: `src/i18n/en.ts`

- [ ] **Step 1: 创建翻译文件 zh-CN.ts**

```typescript
export const zhCN = {
  translation: {
    chat: {
      title: '对话',
      newChat: '新对话',
      newChatDesc: '开始一段新的对话…',
      sendMessage: '发送一条消息开始对话',
      inputPlaceholder: '给 hip 发消息…（Enter 发送，Shift+Enter 换行）',
      send: '发送',
      user: '用户',
      you: '你',
      togglePanel: '切换产物面板',
    },
    sidebar: {
      collapse: '折叠侧边栏',
      pin: '固定侧边栏',
      search: '搜索会话',
      noMatches: '没有匹配的会话',
      deleteSession: '删除会话',
    },
    artifact: {
      doc: '文档',
      files: '文件',
      agents: '智能体',
      diff: 'Diff',
      closePanel: '关闭面板',
      noDoc: '暂无文档',
      noDocDesc: '智能体生成文档后，内容将显示在这里',
      noDiff: '暂无 Diff',
      noDiffDesc: '智能体修改代码后，变更将显示在这里',
      noFiles: '暂无文件',
      noFilesDesc: '与智能体协作时，文件将自动显示在这里',
      waiting: '等待中…',
      parallelAgents: '并行子智能体',
    },
    settings: {
      title: '设置',
      language: '界面语言',
      languageDesc: '应用界面的显示语言',
      languages: {
        'zh-CN': '简体中文',
        'zh-TW': '繁體中文',
        'en': 'English',
      },
    },
    login: {
      slogan: '没有人比我更懂摸鱼',
      title: '登录到 hip',
      subtitle: '选择一种方式继续',
      email: '使用邮箱登录',
      github: '使用 GitHub 登录',
      google: '使用 Google 登录',
      skip: '跳过登录',
    },
    common: {
      close: '关闭',
    },
  },
} as const
```

- [ ] **Step 2: 创建翻译文件 zh-TW.ts**

```typescript
export const zhTW = {
  translation: {
    chat: {
      title: '對話',
      newChat: '新對話',
      newChatDesc: '開始一段新的對話…',
      sendMessage: '發送一條消息開始對話',
      inputPlaceholder: '給 hip 發消息…（Enter 發送，Shift+Enter 換行）',
      send: '發送',
      user: '用戶',
      you: '你',
      togglePanel: '切換產物面板',
    },
    sidebar: {
      collapse: '折疊側邊欄',
      pin: '固定側邊欄',
      search: '搜索會話',
      noMatches: '沒有匹配的會話',
      deleteSession: '刪除會話',
    },
    artifact: {
      doc: '文檔',
      files: '文件',
      agents: '智能體',
      diff: 'Diff',
      closePanel: '關閉面板',
      noDoc: '暫無文檔',
      noDocDesc: '智能體生成文檔後，內容將顯示在這裡',
      noDiff: '暫無 Diff',
      noDiffDesc: '智能體修改代碼後，變更將顯示在這裡',
      noFiles: '暫無文件',
      noFilesDesc: '與智能體協作時，文件將自動顯示在這裡',
      waiting: '等待中…',
      parallelAgents: '並行子智能體',
    },
    settings: {
      title: '設置',
      language: '界面語言',
      languageDesc: '應用界面的顯示語言',
      languages: {
        'zh-CN': '簡體中文',
        'zh-TW': '繁體中文',
        'en': 'English',
      },
    },
    login: {
      slogan: '沒有人比我更懂摸魚',
      title: '登錄到 hip',
      subtitle: '選擇一種方式繼續',
      email: '使用郵箱登錄',
      github: '使用 GitHub 登錄',
      google: '使用 Google 登錄',
      skip: '跳過登錄',
    },
    common: {
      close: '關閉',
    },
  },
} as const
```

- [ ] **Step 3: 创建翻译文件 en.ts**

```typescript
export const en = {
  translation: {
    chat: {
      title: 'Conversation',
      newChat: 'New Chat',
      newChatDesc: 'Start a new conversation…',
      sendMessage: 'Send a message to start the conversation',
      inputPlaceholder: 'Message hip… (Enter to send, Shift+Enter for newline)',
      send: 'Send',
      user: 'User',
      you: 'You',
      togglePanel: 'Toggle Artifact Panel',
    },
    sidebar: {
      collapse: 'Collapse Sidebar',
      pin: 'Pin Sidebar',
      search: 'Search sessions',
      noMatches: 'No matching sessions',
      deleteSession: 'Delete Session',
    },
    artifact: {
      doc: 'Docs',
      files: 'Files',
      agents: 'Agents',
      diff: 'Diff',
      closePanel: 'Close Panel',
      noDoc: 'No documents yet',
      noDocDesc: 'Documents generated by agents will appear here',
      noDiff: 'No diff yet',
      noDiffDesc: 'Changes made by agents will appear here',
      noFiles: 'No files yet',
      noFilesDesc: 'Files will automatically appear when collaborating with agents',
      waiting: 'Waiting…',
      parallelAgents: 'Parallel Sub-agents',
    },
    settings: {
      title: 'Settings',
      language: 'Interface Language',
      languageDesc: 'The display language of the application',
      languages: {
        'zh-CN': '简体中文',
        'zh-TW': '繁體中文',
        'en': 'English',
      },
    },
    login: {
      slogan: 'Nobody knows slacking better than me',
      title: 'Log in to hip',
      subtitle: 'Choose a way to continue',
      email: 'Continue with Email',
      github: 'Continue with GitHub',
      google: 'Continue with Google',
      skip: 'Skip Login',
    },
    common: {
      close: 'Close',
    },
  },
} as const
```

- [ ] **Step 4: 创建 i18n 配置 index.ts**

```typescript
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { zhCN } from './zh-CN'
import { zhTW } from './zh-TW'
import { en } from './en'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': zhCN,
      'zh-TW': zhTW,
      en,
    },
    fallbackLng: 'zh-CN',
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
```

- [ ] **Step 5: Commit**

```bash
git add src/i18n/
git commit -m "feat(i18n): add i18next config and translation files for zh-CN, zh-TW, en"
```

---

## Task 4: 在 main.tsx 中导入 i18n

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1: 添加 i18n 导入**

在 `src/main.tsx` 顶部添加导入：

```tsx
import '@wdio/tauri-plugin'
import './i18n'  // ← 添加此行
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 2: Commit**

```bash
git add src/main.tsx
git commit -m "feat(i18n): initialize i18next in main entry"
```

---

## Task 5: 更新 SettingsPanel.tsx 实现语言切换

**Files:**
- Modify: `src/components/account/SettingsPanel.tsx`

- [ ] **Step 1: 实现语言选择 UI**

```tsx
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'

const LANGUAGE_KEYS = ['zh-CN', 'zh-TW', 'en'] as const

export function SettingsPanel() {
  const { t, i18n } = useTranslation()
  const currentLang = i18n.language as (typeof LANGUAGE_KEYS)[number]

  const cycleLanguage = () => {
    const idx = LANGUAGE_KEYS.indexOf(currentLang)
    const next = LANGUAGE_KEYS[(idx + 1) % LANGUAGE_KEYS.length]
    i18n.changeLanguage(next)
  }

  return (
    <div className="flex items-center justify-between px-6 py-5">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-ink">{t('settings.language')}</div>
        <div className="mt-0.5 text-[12px] text-ink-tertiary">{t('settings.languageDesc')}</div>
      </div>
      <button
        className="ml-4 flex shrink-0 items-center gap-1 text-[13px] text-ink-secondary transition-colors hover:text-ink"
        onClick={cycleLanguage}
      >
        {t(`settings.languages.${currentLang}`)}
        <ChevronRight size={14} className="text-ink-tertiary" />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/account/SettingsPanel.tsx
git commit -m "feat(settings): implement language switching in settings panel"
```

---

## Task 6: 替换所有硬编码中文文本

**Files:**
- Modify: `src/components/chat/ChatHeader.tsx`
- Modify: `src/components/chat/ChatPane.tsx`
- Modify: `src/components/chat/InputBar.tsx`
- Modify: `src/components/chat/MessageBubble.tsx`
- Modify: `src/components/artifact/ArtifactPanel.tsx`
- Modify: `src/components/artifact/DocRenderer.tsx`
- Modify: `src/components/artifact/DiffViewer.tsx`
- Modify: `src/components/artifact/FileTree.tsx`
- Modify: `src/components/artifact/AgentDashboard.tsx`
- Modify: `src/components/sidebar/UserMenu.tsx`
- Modify: `src/components/sidebar/Sidebar.tsx`
- Modify: `src/components/sidebar/SidebarPeek.tsx`
- Modify: `src/components/sidebar/SessionItem.tsx`
- Modify: `src/components/sidebar/SessionList.tsx`
- Modify: `src/components/sidebar/NewChatButton.tsx`
- Modify: `src/components/sidebar/SearchBox.tsx`
- Modify: `src/components/ui/Modal.tsx`
- Modify: `src/routes/LoginScreen.tsx`
- Modify: `src/domain/sessionStore.ts`

- [ ] **Step 1: 替换 ChatHeader.tsx**

```tsx
import { useTranslation } from 'react-i18next'
import { PanelRight } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useActiveSession } from '@/domain'
import { Button } from '@/components/ui/Button'

export function ChatHeader() {
  const { t } = useTranslation()
  const togglePanel = useUiStore((s) => s.togglePanel)
  const active = useActiveSession()

  return (
    <div
      data-tauri-drag-region
      className="relative flex h-11 shrink-0 items-center border-b border-border bg-surface pl-14 pr-3"
    >
      <span className="pointer-events-none absolute left-1/2 max-w-[50%] -translate-x-1/2 truncate text-[13px] font-medium text-ink">
        {active?.title ?? t('chat.title')}
      </span>
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        onClick={togglePanel}
        title={t('chat.togglePanel')}
        data-tauri-drag-region="false"
      >
        <PanelRight size={17} />
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: 替换 ChatPane.tsx**

```tsx
import { useTranslation } from 'react-i18next'

export function ChatPane() {
  const { t } = useTranslation()
  // ... existing code ...
  
  return (
    <div>
      {/* ... existing JSX ... */}
      {t('chat.sendMessage')}
      {/* ... existing JSX ... */}
    </div>
  )
}
```

- [ ] **Step 3: 替换 InputBar.tsx**

```tsx
import { useTranslation } from 'react-i18next'

export function InputBar() {
  const { t } = useTranslation()
  // ... existing code ...
  
  return (
    <div>
      <input placeholder={t('chat.inputPlaceholder')} />
      <button>{t('chat.send')}</button>
    </div>
  )
}
```

- [ ] **Step 4: 替换 MessageBubble.tsx**

```tsx
import { useTranslation } from 'react-i18next'

export function MessageBubble() {
  const { t } = useTranslation()
  // ... existing code ...
  
  return (
    <div>
      {isUser ? t('chat.you') : t('chat.user')}
    </div>
  )
}
```

- [ ] **Step 5: 替换 ArtifactPanel.tsx**

```tsx
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { ArtifactTab } from '@/store/uiStore'
import { useUiStore } from '@/store/uiStore'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import { Button } from '@/components/ui/Button'
import { DocRenderer } from './DocRenderer'
import { FileTree } from './FileTree'
import { AgentDashboard } from './AgentDashboard'
import { DiffViewer } from './DiffViewer'

export function ArtifactPanel() {
  const { t } = useTranslation()
  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  const togglePanel = useUiStore((s) => s.togglePanel)

  const TABS: { value: ArtifactTab; label: string }[] = [
    { value: 'doc', label: t('artifact.doc') },
    { value: 'files', label: t('artifact.files') },
    { value: 'agents', label: t('artifact.agents') },
    { value: 'diff', label: t('artifact.diff') },
  ]

  return (
    <div className="h-full bg-surface">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setTab(v as ArtifactTab)}
        className="flex h-full flex-col"
      >
        <div
          data-tauri-drag-region
          className="flex h-11 shrink-0 items-center justify-between border-b border-border px-2"
        >
          <TabsList className="h-full gap-4" data-tauri-drag-region="false">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" onClick={togglePanel} title={t('artifact.closePanel')} data-tauri-drag-region="false">
              <X size={16} />
            </Button>
          </div>
        </div>
        {/* ... TabsContent ... */}
      </Tabs>
    </div>
  )
}
```

- [ ] **Step 6: 替换 artifact 空状态组件**

`DocRenderer.tsx`:
```tsx
const { t } = useTranslation()
// 替换：暂无文档 → t('artifact.noDoc')
// 替换：智能体生成文档后... → t('artifact.noDocDesc')
```

`DiffViewer.tsx`:
```tsx
const { t } = useTranslation()
// 替换：暂无 Diff → t('artifact.noDiff')
// 替换：智能体修改代码后... → t('artifact.noDiffDesc')
```

`FileTree.tsx`:
```tsx
const { t } = useTranslation()
// 替换：暂无文件 → t('artifact.noFiles')
// 替换：与智能体协作时... → t('artifact.noFilesDesc')
```

`AgentDashboard.tsx`:
```tsx
const { t } = useTranslation()
// 替换：等待中… → t('artifact.waiting')
// 替换：并行子智能体 → t('artifact.parallelAgents')
```

- [ ] **Step 7: 替换 sidebar 组件**

`UserMenu.tsx`:
```tsx
const { t } = useTranslation()
// 替换：设置 → t('settings.title')
// 替换：退出登录 → t('login.logout') 或新增 key
```

`Sidebar.tsx`:
```tsx
const { t } = useTranslation()
// 替换：折叠侧边栏 → t('sidebar.collapse')
```

`SidebarPeek.tsx`:
```tsx
const { t } = useTranslation()
// 替换：固定侧边栏 → t('sidebar.pin')
```

`SessionItem.tsx`:
```tsx
const { t } = useTranslation()
// 替换：删除会话 → t('sidebar.deleteSession')
```

`SessionList.tsx`:
```tsx
const { t } = useTranslation()
// 替换：没有匹配的会话 → t('sidebar.noMatches')
```

`NewChatButton.tsx`:
```tsx
const { t } = useTranslation()
// 替换：新对话 → t('chat.newChat')
```

`SearchBox.tsx`:
```tsx
const { t } = useTranslation()
// 替换：搜索会话 → t('sidebar.search')
```

- [ ] **Step 8: 替换其他组件**

`Modal.tsx`:
```tsx
const { t } = useTranslation()
// 替换：关闭 → t('common.close')
```

`LoginScreen.tsx`:
```tsx
const { t } = useTranslation()
// 替换所有硬编码中文为对应翻译键
```

`sessionStore.ts`:
```tsx
// 替换：新对话 → t('chat.newChat')
// 替换：开始一段新的对话… → t('chat.newChatDesc')
```

- [ ] **Step 9: Commit**

```bash
git add src/
git commit -m "feat(i18n): replace all hardcoded Chinese text with i18n translations"
```

---

## Task 7: 运行测试和类型检查

- [ ] **Step 1: 运行类型检查**

```bash
yarn type-check
```

Expected: 无错误

- [ ] **Step 2: 运行单元测试**

```bash
yarn test
```

Expected: 所有测试通过

- [ ] **Step 3: 手动验证**

1. 启动应用，确认右侧面板默认关闭
2. 点击 ChatHeader 切换按钮，确认面板可正常展开
3. 打开设置面板，切换语言，确认所有文本即时更新
4. 重启应用，确认上次选择的语言已保持

---

## Self-Review Checklist

- [ ] **Spec coverage**: 右侧面板修复和国际化两个需求都有对应的任务
- [ ] **Placeholder scan**: 无 TBD/TODO/待补充
- [ ] **Type consistency**: 所有翻译键在代码和翻译文件中一致
- [ ] **File paths**: 所有路径基于实际代码库结构

## 执行方式选择

**Plan complete and saved to `docs/superpowers/plans/2026-06-07-right-panel-i18n-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
