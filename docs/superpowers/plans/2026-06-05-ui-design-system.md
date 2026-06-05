# 三栏布局 UI 设计系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 hip 智能体编码桌面应用构建一套完整、可交互的三栏布局亮色 UI，全部由静态 mock 数据驱动，流式效果用定时器模拟，不连真实 WebSocket / sidecar。

**Architecture:** 在现有 React 18 + Vite + Tauri 项目上新增一个独立视图层。引入 Tailwind CSS（token 化）+ 手写 shadcn 风格基础组件 + `react-resizable-panels`（三栏拖拽）+ React Router（登录页/主界面）。现有逻辑层（`sessionStore`、`ws-client`、hooks、`packages/*`、`src-tauri/*`）保留在磁盘但不再挂载——新的 `App.tsx` 改为渲染路由，不再渲染会发起 WS 连接的 `AppShell`。UI 本地状态放在独立的 `uiStore`，由 mock 数据 seed。

**Tech Stack:** React 18.3 · TypeScript 5.6（strict）· Vite 6 · Tailwind CSS 3 · class-variance-authority · react-resizable-panels 2 · react-router-dom 6 · lucide-react · react-markdown · Radix（DropdownMenu / Tabs）· Vitest（纯逻辑单测）

**Testing philosophy:** 这是纯展示型 mock UI，绝大多数组件没有业务逻辑，render 测试价值低。因此：**纯函数与状态逻辑**（会话过滤、流式分词、mock 数据完整性、store reducer）用 Vitest 单测覆盖；**展示型组件**用 `yarn type-check`（0 error）+ 浏览器目视验证（`yarn dev` → http://localhost:1420）。每个组件任务都把组件挂到可见路由上，确保增量可见。

---

## File Structure

```
src/
├── App.tsx                      # 改：渲染 RouterProvider（不再用 AppShell）
├── main.tsx                     # 改：import './styles/tokens.css'
├── lib/
│   ├── utils.ts                 # cn() className 合并
│   ├── sessions.ts              # filterSessions() 纯函数
│   └── stream.ts                # tokenize() 流式分词纯函数
├── styles/
│   └── tokens.css               # @tailwind 指令 + CSS 变量 token + base
├── mock/
│   ├── types.ts                 # 所有 UI 数据类型
│   ├── user.ts                  # mockUser
│   ├── sessions.ts              # mockSessions
│   ├── messages.ts              # mockMessages + CANNED_REPLY
│   ├── agents.ts                # mockAgents（含 seed 工厂）
│   ├── fileTree.ts              # mockFileTree
│   ├── diff.ts                  # mockDiff
│   └── doc.ts                   # mockDoc（markdown 字符串）
├── store/
│   └── uiStore.ts               # 新增：Zustand UI 状态（mock 驱动）
├── hooks/
│   └── useSimulatedStream.ts    # 模拟流式 + 并行 agent 状态机
├── components/
│   ├── ui/                      # 基础组件
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Textarea.tsx
│   │   ├── Badge.tsx
│   │   ├── Avatar.tsx
│   │   ├── Separator.tsx
│   │   ├── Tabs.tsx             # Radix 封装
│   │   └── DropdownMenu.tsx     # Radix 封装
│   ├── login/
│   │   └── AuthButton.tsx
│   ├── sidebar/
│   │   ├── Sidebar.tsx
│   │   ├── NewChatButton.tsx
│   │   ├── SearchBox.tsx
│   │   ├── SessionList.tsx
│   │   ├── SessionItem.tsx
│   │   └── UserMenu.tsx
│   ├── chat/
│   │   ├── ChatHeader.tsx
│   │   ├── ChatPane.tsx
│   │   ├── MessageBubble.tsx
│   │   ├── StreamingCursor.tsx
│   │   └── InputBar.tsx
│   └── artifact/
│       ├── ArtifactPanel.tsx
│       ├── DocRenderer.tsx
│       ├── FileTree.tsx
│       ├── AgentDashboard.tsx
│       └── DiffViewer.tsx
└── routes/
    ├── LoginScreen.tsx
    └── AppLayout.tsx

# 配置（根目录）
tailwind.config.js               # 新增
postcss.config.js                # 新增
vitest.config.ts                 # 新增
vite.config.ts                   # 改：加 @ alias
tsconfig.json                    # 改：加 @/* paths
package.json                     # 改：deps + test 脚本
```

**保留不动（不挂载）：** `src/components/layout/*`、`src/components/session/*`、`src/hooks/useWebSocket.ts`、`src/hooks/useSession.ts`、`src/store/sessionStore.ts`、`src/ipc/ws-client.ts`。

---

### Task 1: 工具链 — 依赖 + Tailwind + token + 别名

**Files:**
- Modify: `package.json`
- Create: `tailwind.config.js`
- Create: `postcss.config.js`
- Create: `src/styles/tokens.css`
- Modify: `src/main.tsx`
- Modify: `vite.config.ts`
- Modify: `tsconfig.json`

- [ ] **Step 1: 安装运行时依赖**

```bash
yarn add react-router-dom@^6 react-resizable-panels@^2 lucide-react@^0.460 clsx@^2 tailwind-merge@^2 class-variance-authority@^0.7 react-markdown@^9 @radix-ui/react-dropdown-menu@^2 @radix-ui/react-tabs@^1
```

Expected: 安装完成，`package.json` dependencies 增加上述包。

- [ ] **Step 2: 安装开发依赖**

```bash
yarn add -D tailwindcss@^3 postcss@^8 autoprefixer@^10 vitest@^2
```

Expected: devDependencies 增加 tailwindcss、postcss、autoprefixer、vitest。

- [ ] **Step 3: 创建 `tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'var(--border)',
        surface: {
          DEFAULT: 'var(--bg-app)',
          subtle: 'var(--bg-subtle)',
          muted: 'var(--bg-muted)',
        },
        ink: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          subtle: 'var(--accent-subtle)',
        },
        success: 'var(--success)',
        danger: 'var(--danger)',
        warning: 'var(--warning)',
        role: {
          supervisor: 'var(--role-supervisor)',
          planner: 'var(--role-planner)',
          coder: 'var(--role-coder)',
          reviewer: 'var(--role-reviewer)',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['SF Mono', 'JetBrains Mono', 'Menlo', 'monospace'],
      },
      boxShadow: {
        pop: '0 1px 3px rgba(0,0,0,0.08)',
        float: '0 8px 24px rgba(0,0,0,0.12)',
      },
      keyframes: {
        blink: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
        pulse: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
      },
      animation: {
        blink: 'blink 1s step-start infinite',
        pulse: 'pulse 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 4: 创建 `postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 5: 创建 `src/styles/tokens.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg-app: #ffffff;
  --bg-subtle: #f7f7f8;
  --bg-muted: #f0f0f1;
  --border: #e6e6e8;
  --text-primary: #1a1a1a;
  --text-secondary: #6b6b70;
  --text-tertiary: #9b9ba0;
  --accent: #5b5bd6;
  --accent-hover: #4a4ac4;
  --accent-subtle: #eeeefb;
  --success: #3d9a50;
  --danger: #d64545;
  --warning: #c77a1a;
  --role-supervisor: #5b5bd6;
  --role-planner: #1a8cd8;
  --role-coder: #3d9a50;
  --role-reviewer: #c77a1a;
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  background: var(--bg-app);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

* {
  box-sizing: border-box;
}
```

- [ ] **Step 6: 修改 `src/main.tsx`** — 引入 token 样式（替换整个文件）

```tsx
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

- [ ] **Step 7: 修改 `vite.config.ts`** — 增加 `@` 别名（仅改 `resolve.alias`）

把 `resolve.alias` 改为：

```ts
  resolve: {
    alias: {
      "@hip/protocol": resolve(__dirname, "packages/protocol/src/index.ts"),
      "@": resolve(__dirname, "src"),
    },
  },
```

- [ ] **Step 8: 修改 `tsconfig.json`** — 增加 `@/*` 路径

把 `compilerOptions.paths` 改为：

```json
    "paths": {
      "@hip/protocol": ["packages/protocol/src/index.ts"],
      "@/*": ["src/*"]
    }
```

- [ ] **Step 9: 验证 dev server 启动**

Run: `yarn dev` （启动后 Ctrl-C 退出）
Expected: Vite 在 1420 端口启动，无 Tailwind/PostCSS 编译报错。（此时页面仍是旧 AppShell，可能因非 Tauri 环境报 invoke 错误，属正常，Task 7 会替换。）

- [ ] **Step 10: Commit**

```bash
git add package.json yarn.lock tailwind.config.js postcss.config.js src/styles/tokens.css src/main.tsx vite.config.ts tsconfig.json
git commit -m "build: add tailwind, design tokens, routing/resizable deps and @ alias"
```

---

### Task 2: `cn()` 工具 + Vitest 接入

**Files:**
- Create: `src/lib/utils.ts`
- Create: `vitest.config.ts`
- Create: `src/lib/utils.test.ts`
- Modify: `package.json`（加 test 脚本）

- [ ] **Step 1: 创建 `src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 2: 创建 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 3: 加 test 脚本到 `package.json`**

在 `scripts` 中新增两行（保留已有脚本）：

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 4: 写失败测试 `src/lib/utils.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('dedupes conflicting tailwind classes (last wins)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('drops falsy values', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c')
  })
})
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `yarn test`
Expected: 3 个测试全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils.ts src/lib/utils.test.ts vitest.config.ts package.json
git commit -m "feat: add cn() class-merge util and vitest harness"
```

---

### Task 3: 基础 UI 组件（无 Radix）

**Files:**
- Create: `src/components/ui/Button.tsx`
- Create: `src/components/ui/Input.tsx`
- Create: `src/components/ui/Textarea.tsx`
- Create: `src/components/ui/Badge.tsx`
- Create: `src/components/ui/Avatar.tsx`
- Create: `src/components/ui/Separator.tsx`

- [ ] **Step 1: 创建 `src/components/ui/Button.tsx`**

```tsx
import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white hover:bg-accent-hover',
        secondary: 'bg-surface-muted text-ink hover:bg-border',
        ghost: 'text-ink-secondary hover:bg-surface-muted hover:text-ink',
        outline: 'border border-border bg-surface text-ink hover:bg-surface-muted',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-9 px-4 text-sm',
        lg: 'h-10 px-5 text-base',
        icon: 'h-8 w-8 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
)
Button.displayName = 'Button'
```

- [ ] **Step 2: 创建 `src/components/ui/Input.tsx`**

```tsx
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink',
        'placeholder:text-ink-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
```

- [ ] **Step 3: 创建 `src/components/ui/Textarea.tsx`**

```tsx
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink',
        'placeholder:text-ink-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
```

- [ ] **Step 4: 创建 `src/components/ui/Badge.tsx`**

```tsx
import { cn } from '@/lib/utils'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: string
}

export function Badge({ className, color, style, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        'bg-surface-muted text-ink-secondary',
        className,
      )}
      style={color ? { color, ...style } : style}
      {...props}
    />
  )
}
```

- [ ] **Step 5: 创建 `src/components/ui/Avatar.tsx`**

```tsx
import { cn } from '@/lib/utils'

interface AvatarProps {
  name: string
  src?: string
  size?: number
  className?: string
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return chars.toUpperCase()
}

export function Avatar({ name, src, size = 32, className }: AvatarProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-subtle text-[12px] font-semibold text-accent',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  )
}
```

- [ ] **Step 6: 创建 `src/components/ui/Separator.tsx`**

```tsx
import { cn } from '@/lib/utils'

export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-border', className)} />
}
```

- [ ] **Step 7: 类型检查**

Run: `yarn type-check`
Expected: 0 errors。

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/Button.tsx src/components/ui/Input.tsx src/components/ui/Textarea.tsx src/components/ui/Badge.tsx src/components/ui/Avatar.tsx src/components/ui/Separator.tsx
git commit -m "feat(ui): add Button, Input, Textarea, Badge, Avatar, Separator primitives"
```

---

### Task 4: Radix 封装组件 — Tabs + DropdownMenu

> 说明：spec 组件清单列了 Tooltip 与 ScrollArea，但本计划按 spec 依赖表「@radix-ui/* 按需」的原则**有意省略**它们——提示用原生 `title` 属性，滚动用 `overflow-y-auto`，避免引入未被交互真正需要的依赖。其余基础组件全部覆盖。

**Files:**
- Create: `src/components/ui/Tabs.tsx`
- Create: `src/components/ui/DropdownMenu.tsx`

- [ ] **Step 1: 创建 `src/components/ui/Tabs.tsx`**

```tsx
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const Tabs = TabsPrimitive.Root

export const TabsList = forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('flex items-center gap-1', className)}
    {...props}
  />
))
TabsList.displayName = 'TabsList'

export const TabsTrigger = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-ink-secondary transition-colors',
      'hover:bg-surface-muted hover:text-ink',
      'data-[state=active]:bg-accent-subtle data-[state=active]:text-accent',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = 'TabsTrigger'

export const TabsContent = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('flex-1 overflow-auto focus-visible:outline-none', className)}
    {...props}
  />
))
TabsContent.displayName = 'TabsContent'
```

- [ ] **Step 2: 创建 `src/components/ui/DropdownMenu.tsx`**

```tsx
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const DropdownMenu = DropdownPrimitive.Root
export const DropdownMenuTrigger = DropdownPrimitive.Trigger

export const DropdownMenuContent = forwardRef<
  React.ElementRef<typeof DropdownPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownPrimitive.Portal>
    <DropdownPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-[200px] rounded-lg border border-border bg-surface p-1 shadow-float',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        className,
      )}
      {...props}
    />
  </DropdownPrimitive.Portal>
))
DropdownMenuContent.displayName = 'DropdownMenuContent'

export const DropdownMenuItem = forwardRef<
  React.ElementRef<typeof DropdownPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownPrimitive.Item
    ref={ref}
    className={cn(
      'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-ink outline-none',
      'focus:bg-surface-muted data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = 'DropdownMenuItem'

export const DropdownMenuSeparator = forwardRef<
  React.ElementRef<typeof DropdownPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownPrimitive.Separator
    ref={ref}
    className={cn('my-1 h-px bg-border', className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator'

export const DropdownMenuLabel = forwardRef<
  React.ElementRef<typeof DropdownPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownPrimitive.Label
    ref={ref}
    className={cn('px-2.5 py-1.5 text-[11px] font-medium text-ink-tertiary', className)}
    {...props}
  />
))
DropdownMenuLabel.displayName = 'DropdownMenuLabel'
```

- [ ] **Step 3: 类型检查**

Run: `yarn type-check`
Expected: 0 errors。

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/Tabs.tsx src/components/ui/DropdownMenu.tsx
git commit -m "feat(ui): add Radix Tabs and DropdownMenu wrappers"
```

---

### Task 5: Mock 数据 + 类型

**Files:**
- Create: `src/mock/types.ts`
- Create: `src/mock/user.ts`
- Create: `src/mock/sessions.ts`
- Create: `src/mock/messages.ts`
- Create: `src/mock/agents.ts`
- Create: `src/mock/fileTree.ts`
- Create: `src/mock/diff.ts`
- Create: `src/mock/doc.ts`
- Create: `src/mock/mock.test.ts`

- [ ] **Step 1: 创建 `src/mock/types.ts`**

```ts
export type Role = 'supervisor' | 'planner' | 'coder' | 'reviewer'
export type AgentStatus = 'idle' | 'running' | 'done'
export type ArtifactTab = 'doc' | 'files' | 'agents' | 'diff'

export interface MockUser {
  name: string
  email: string
  avatarUrl?: string
}

export interface MockSession {
  id: string
  title: string
  preview: string
  updatedAt: string // 人类可读，如 "2h ago"
}

export interface MockMessage {
  id: string
  role: 'user' | 'assistant'
  content: string // markdown
}

export interface MockAgent {
  id: string
  role: Role
  title: string
  status: AgentStatus
  tokens: string
  tokenCount: number
  elapsedMs: number
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: FileNode[]
}

export type DiffLineType = 'add' | 'del' | 'ctx'

export interface DiffLine {
  type: DiffLineType
  content: string
  oldNo: number | null
  newNo: number | null
}

export interface DiffFile {
  path: string
  additions: number
  deletions: number
  lines: DiffLine[]
}
```

- [ ] **Step 2: 创建 `src/mock/user.ts`**

```ts
import type { MockUser } from './types'

export const mockUser: MockUser = {
  name: 'Shane Hughes',
  email: 'shane@brew-master.com',
}
```

- [ ] **Step 3: 创建 `src/mock/sessions.ts`**

```ts
import type { MockSession } from './types'

export const mockSessions: MockSession[] = [
  { id: 's1', title: '重构 WebSocket 客户端', preview: '把 ws-client 拆成可测试的小模块…', updatedAt: '2m ago' },
  { id: 's2', title: '三栏布局 UI', preview: '亮色主题 + 可拖拽面板', updatedAt: '18m ago' },
  { id: 's3', title: '修复 sidecar 端口竞争', preview: 'findAvailablePort 偶发返回占用端口', updatedAt: '1h ago' },
  { id: 's4', title: 'LangGraph supervisor 路由', preview: '根据任务复杂度分发子 agent', updatedAt: '3h ago' },
  { id: 's5', title: '添加 Git diff 渲染', preview: '行级高亮 + 折叠 hunk', updatedAt: 'Yesterday' },
  { id: 's6', title: '打包 sidecar 为单文件', preview: '用 ncc 构建独立 bundle', updatedAt: 'Yesterday' },
  { id: 's7', title: '智能体并行面板设计', preview: 'supervisor + 子 agent 卡片网格', updatedAt: '2d ago' },
  { id: 's8', title: '亮色 token 体系', preview: '低饱和品牌色 + 充足留白', updatedAt: '3d ago' },
]
```

- [ ] **Step 4: 创建 `src/mock/messages.ts`**

```ts
import type { MockMessage } from './types'

export const mockMessages: MockMessage[] = [
  {
    id: 'm1',
    role: 'user',
    content: '帮我把 ws-client 拆成更容易测试的小模块，并加上重连逻辑。',
  },
  {
    id: 'm2',
    role: 'assistant',
    content: [
      '好的，我会把 `ws-client.ts` 拆成三个职责清晰的单元：',
      '',
      '1. **`connection.ts`** — 只负责底层 WebSocket 的建立与关闭',
      '2. **`reconnect.ts`** — 指数退避重连策略（纯函数，易测试）',
      '3. **`client.ts`** — 组合上面两者，对外暴露 `send` / `onMessage`',
      '',
      '重连退避的核心是这段纯函数：',
      '',
      '```ts',
      'export function backoff(attempt: number): number {',
      '  return Math.min(1000 * 2 ** attempt, 30_000)',
      '}',
      '```',
      '',
      '这样每一块都能独立测试，`backoff` 甚至不需要 mock 任何东西。',
    ].join('\n'),
  },
]

// 发送消息时模拟流式输出的助手回复
export const CANNED_REPLY = [
  '我来分析一下这个需求。先并行启动几个子 agent：',
  '',
  '- **planner** 负责拆解任务边界',
  '- **coder** 负责生成实现代码',
  '- **reviewer** 负责审查正确性',
  '',
  '右侧「智能体」面板可以看到它们并行运行的实时状态。综合三者结果后，我会给出最终方案。',
].join('\n')
```

- [ ] **Step 5: 创建 `src/mock/agents.ts`**

```ts
import type { MockAgent } from './types'

export const mockAgents: MockAgent[] = [
  { id: 'a0', role: 'supervisor', title: 'Supervisor', status: 'done', tokens: '任务较复杂，分发给 3 个子 agent 并行处理。', tokenCount: 142, elapsedMs: 1200 },
  { id: 'a1', role: 'planner', title: 'Planner', status: 'done', tokens: '拆解为 3 个文件：connection / reconnect / client。', tokenCount: 318, elapsedMs: 2400 },
  { id: 'a2', role: 'coder', title: 'Coder', status: 'done', tokens: '实现 backoff 指数退避与 client 组合层。', tokenCount: 1024, elapsedMs: 5200 },
  { id: 'a3', role: 'reviewer', title: 'Reviewer', status: 'done', tokens: '检查边界条件：最大退避封顶 30s，OK。', tokenCount: 256, elapsedMs: 1800 },
]

// 发送新消息时，用这个工厂 seed 一组「待运行」的 agent
export function seedAgents(): MockAgent[] {
  return [
    { id: 'a0', role: 'supervisor', title: 'Supervisor', status: 'running', tokens: '', tokenCount: 0, elapsedMs: 0 },
    { id: 'a1', role: 'planner', title: 'Planner', status: 'idle', tokens: '', tokenCount: 0, elapsedMs: 0 },
    { id: 'a2', role: 'coder', title: 'Coder', status: 'idle', tokens: '', tokenCount: 0, elapsedMs: 0 },
    { id: 'a3', role: 'reviewer', title: 'Reviewer', status: 'idle', tokens: '', tokenCount: 0, elapsedMs: 0 },
  ]
}
```

- [ ] **Step 6: 创建 `src/mock/fileTree.ts`**

```ts
import type { FileNode } from './types'

export const mockFileTree: FileNode = {
  name: 'ws-client',
  path: 'src/ipc/ws-client',
  type: 'dir',
  children: [
    { name: 'connection.ts', path: 'src/ipc/ws-client/connection.ts', type: 'file' },
    { name: 'reconnect.ts', path: 'src/ipc/ws-client/reconnect.ts', type: 'file' },
    { name: 'client.ts', path: 'src/ipc/ws-client/client.ts', type: 'file' },
    {
      name: '__tests__',
      path: 'src/ipc/ws-client/__tests__',
      type: 'dir',
      children: [
        { name: 'reconnect.test.ts', path: 'src/ipc/ws-client/__tests__/reconnect.test.ts', type: 'file' },
        { name: 'client.test.ts', path: 'src/ipc/ws-client/__tests__/client.test.ts', type: 'file' },
      ],
    },
    { name: 'index.ts', path: 'src/ipc/ws-client/index.ts', type: 'file' },
  ],
}
```

- [ ] **Step 7: 创建 `src/mock/diff.ts`**

```ts
import type { DiffFile } from './types'

export const mockDiff: DiffFile[] = [
  {
    path: 'src/ipc/ws-client/reconnect.ts',
    additions: 6,
    deletions: 0,
    lines: [
      { type: 'add', content: 'export function backoff(attempt: number): number {', oldNo: null, newNo: 1 },
      { type: 'add', content: '  return Math.min(1000 * 2 ** attempt, 30_000)', oldNo: null, newNo: 2 },
      { type: 'add', content: '}', oldNo: null, newNo: 3 },
      { type: 'add', content: '', oldNo: null, newNo: 4 },
      { type: 'add', content: 'export const MAX_RETRIES = 8', oldNo: null, newNo: 5 },
    ],
  },
  {
    path: 'src/ipc/ws-client.ts',
    additions: 1,
    deletions: 2,
    lines: [
      { type: 'ctx', content: 'class WsClient {', oldNo: 10, newNo: 10 },
      { type: 'del', content: '  private retries = 0', oldNo: 11, newNo: null },
      { type: 'del', content: '  // TODO: reconnect', oldNo: 12, newNo: null },
      { type: 'add', content: '  private readonly reconnector = new Reconnector()', oldNo: null, newNo: 11 },
      { type: 'ctx', content: '}', oldNo: 13, newNo: 12 },
    ],
  },
]
```

- [ ] **Step 8: 创建 `src/mock/doc.ts`**

```ts
export const mockDoc = [
  '# WebSocket 客户端重构方案',
  '',
  '## 目标',
  '',
  '把单文件 `ws-client.ts` 拆分为职责单一、可独立测试的模块。',
  '',
  '## 模块划分',
  '',
  '| 模块 | 职责 | 是否纯函数 |',
  '| --- | --- | --- |',
  '| `connection.ts` | 建立 / 关闭 WebSocket | 否 |',
  '| `reconnect.ts` | 指数退避策略 | 是 |',
  '| `client.ts` | 组合对外接口 | 否 |',
  '',
  '## 退避算法',
  '',
  '```ts',
  'export function backoff(attempt: number): number {',
  '  return Math.min(1000 * 2 ** attempt, 30_000)',
  '}',
  '```',
  '',
  '> 最大退避封顶 30 秒，避免无限增长。',
].join('\n')
```

- [ ] **Step 9: 写完整性测试 `src/mock/mock.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { mockSessions } from './sessions'
import { mockAgents, seedAgents } from './agents'
import { mockDiff } from './diff'
import { mockFileTree } from './fileTree'

describe('mock data integrity', () => {
  it('sessions have unique ids', () => {
    const ids = mockSessions.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('seedAgents starts supervisor running, children idle', () => {
    const agents = seedAgents()
    expect(agents[0].role).toBe('supervisor')
    expect(agents[0].status).toBe('running')
    expect(agents.slice(1).every((a) => a.status === 'idle')).toBe(true)
  })

  it('mockAgents covers all four roles', () => {
    const roles = mockAgents.map((a) => a.role)
    expect(roles).toEqual(['supervisor', 'planner', 'coder', 'reviewer'])
  })

  it('diff additions/deletions match line counts', () => {
    for (const file of mockDiff) {
      expect(file.lines.filter((l) => l.type === 'add').length).toBe(file.additions)
      expect(file.lines.filter((l) => l.type === 'del').length).toBe(file.deletions)
    }
  })

  it('file tree root is a directory with children', () => {
    expect(mockFileTree.type).toBe('dir')
    expect(mockFileTree.children?.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 10: 运行测试**

Run: `yarn test`
Expected: 所有 mock 测试 + 之前的 cn 测试全部 PASS。

- [ ] **Step 11: Commit**

```bash
git add src/mock/
git commit -m "feat(mock): add typed mock data for sessions, messages, agents, files, diff, doc"
```

---

### Task 6: UI 状态 Store + 会话过滤纯函数

**Files:**
- Create: `src/lib/sessions.ts`
- Create: `src/lib/sessions.test.ts`
- Create: `src/store/uiStore.ts`

- [ ] **Step 1: 创建 `src/lib/sessions.ts`**

```ts
import type { MockSession } from '@/mock/types'

export function filterSessions(sessions: MockSession[], query: string): MockSession[] {
  const q = query.trim().toLowerCase()
  if (!q) return sessions
  return sessions.filter(
    (s) => s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q),
  )
}
```

- [ ] **Step 2: 写失败测试 `src/lib/sessions.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { filterSessions } from './sessions'
import type { MockSession } from '@/mock/types'

const data: MockSession[] = [
  { id: '1', title: 'WebSocket 重构', preview: 'ws client', updatedAt: '' },
  { id: '2', title: '布局', preview: '三栏 layout', updatedAt: '' },
]

describe('filterSessions', () => {
  it('returns all when query empty', () => {
    expect(filterSessions(data, '')).toHaveLength(2)
  })

  it('matches title case-insensitively', () => {
    expect(filterSessions(data, 'websocket')).toHaveLength(1)
  })

  it('matches preview text', () => {
    expect(filterSessions(data, 'layout')).toHaveLength(1)
  })

  it('returns empty on no match', () => {
    expect(filterSessions(data, 'zzz')).toHaveLength(0)
  })
})
```

- [ ] **Step 3: 运行测试，确认通过**

Run: `yarn test src/lib/sessions.test.ts`
Expected: 4 个测试 PASS。

- [ ] **Step 4: 创建 `src/store/uiStore.ts`**

```ts
import { create } from 'zustand'
import type { ArtifactTab, MockAgent, MockMessage, MockSession } from '@/mock/types'
import { mockSessions } from '@/mock/sessions'
import { mockMessages } from '@/mock/messages'
import { mockAgents } from '@/mock/agents'

interface UiState {
  // 侧边栏
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  toggleCollapsed: () => void

  // 会话
  sessions: MockSession[]
  activeSessionId: string
  search: string
  setSearch: (q: string) => void
  selectSession: (id: string) => void
  newSession: () => void
  deleteSession: (id: string) => void

  // 对话消息（按会话）
  messagesBySession: Record<string, MockMessage[]>
  appendMessage: (sessionId: string, msg: MockMessage) => void
  appendToLastAssistant: (sessionId: string, delta: string) => void

  // 产物面板
  panelOpen: boolean
  panelFullscreen: boolean
  activeTab: ArtifactTab
  setTab: (t: ArtifactTab) => void
  togglePanel: () => void
  toggleFullscreen: () => void

  // 智能体
  agents: MockAgent[]
  setAgents: (agents: MockAgent[]) => void
  setAgentStatus: (id: string, status: MockAgent['status']) => void
  appendAgentTokens: (id: string, delta: string) => void
}

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

export const useUiStore = create<UiState>((set) => ({
  collapsed: false,
  setCollapsed: (v) => set({ collapsed: v }),
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),

  sessions: mockSessions,
  activeSessionId: mockSessions[0].id,
  search: '',
  setSearch: (q) => set({ search: q }),
  selectSession: (id) => set({ activeSessionId: id }),
  newSession: () =>
    set((s) => {
      const id = nextId('s')
      const session: MockSession = { id, title: '新对话', preview: '开始一段新的对话…', updatedAt: 'now' }
      return {
        sessions: [session, ...s.sessions],
        activeSessionId: id,
        messagesBySession: { ...s.messagesBySession, [id]: [] },
      }
    }),
  deleteSession: (id) =>
    set((s) => {
      const sessions = s.sessions.filter((x) => x.id !== id)
      const activeSessionId = s.activeSessionId === id ? (sessions[0]?.id ?? '') : s.activeSessionId
      return { sessions, activeSessionId }
    }),

  messagesBySession: { [mockSessions[0].id]: mockMessages },
  appendMessage: (sessionId, msg) =>
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: [...(s.messagesBySession[sessionId] ?? []), msg],
      },
    })),
  appendToLastAssistant: (sessionId, delta) =>
    set((s) => {
      const list = s.messagesBySession[sessionId] ?? []
      if (list.length === 0) return s
      const last = list[list.length - 1]
      if (last.role !== 'assistant') return s
      const updated = { ...last, content: last.content + delta }
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: [...list.slice(0, -1), updated],
        },
      }
    }),

  panelOpen: true,
  panelFullscreen: false,
  activeTab: 'agents',
  setTab: (t) => set({ activeTab: t }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  toggleFullscreen: () => set((s) => ({ panelFullscreen: !s.panelFullscreen })),

  agents: mockAgents,
  setAgents: (agents) => set({ agents }),
  setAgentStatus: (id, status) =>
    set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, status } : a)) })),
  appendAgentTokens: (id, delta) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === id ? { ...a, tokens: a.tokens + delta, tokenCount: a.tokenCount + delta.length } : a,
      ),
    })),
}))
```

- [ ] **Step 5: 类型检查**

Run: `yarn type-check`
Expected: 0 errors。

- [ ] **Step 6: Commit**

```bash
git add src/lib/sessions.ts src/lib/sessions.test.ts src/store/uiStore.ts
git commit -m "feat(store): add uiStore and filterSessions helper"
```

---

### Task 7: 路由骨架 — App.tsx + 占位路由

**Files:**
- Modify: `src/App.tsx`
- Create: `src/routes/LoginScreen.tsx`
- Create: `src/routes/AppLayout.tsx`

> 使用 `createHashRouter`：Tauri 生产环境用 `file://` 协议，HashRouter 在 dev 与打包后都能正常工作。本任务先建占位页，后续任务替换内容。

- [ ] **Step 1: 创建占位 `src/routes/LoginScreen.tsx`**

```tsx
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'

export function LoginScreen() {
  const navigate = useNavigate()
  return (
    <div className="flex h-screen items-center justify-center">
      <Button onClick={() => navigate('/app')}>进入应用（占位）</Button>
    </div>
  )
}
```

- [ ] **Step 2: 创建占位 `src/routes/AppLayout.tsx`**

```tsx
export function AppLayout() {
  return <div className="flex h-screen items-center justify-center text-ink-tertiary">主界面占位</div>
}
```

- [ ] **Step 3: 替换 `src/App.tsx`**

```tsx
import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom'
import { LoginScreen } from './routes/LoginScreen'
import { AppLayout } from './routes/AppLayout'

const router = createHashRouter([
  { path: '/', element: <Navigate to="/login" replace /> },
  { path: '/login', element: <LoginScreen /> },
  { path: '/app', element: <AppLayout /> },
])

function App() {
  return <RouterProvider router={router} />
}

export default App
```

- [ ] **Step 4: 类型检查**

Run: `yarn type-check`
Expected: 0 errors。

- [ ] **Step 5: 目视验证**

Run: `yarn dev`，浏览器打开 http://localhost:1420
Expected: 自动跳到 `/#/login`，显示「进入应用（占位）」按钮；点击后跳到 `/#/app` 显示「主界面占位」。验证后 Ctrl-C。

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/routes/LoginScreen.tsx src/routes/AppLayout.tsx
git commit -m "feat(routes): wire hash router with login and app placeholder routes"
```

---

### Task 8: 登录页 — LoginScreen + AuthButton

**Files:**
- Create: `src/components/login/AuthButton.tsx`
- Modify: `src/routes/LoginScreen.tsx`

- [ ] **Step 1: 创建 `src/components/login/AuthButton.tsx`**

```tsx
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AuthButtonProps {
  icon: LucideIcon
  label: string
  onClick: () => void
  variant?: 'solid' | 'outline'
}

export function AuthButton({ icon: Icon, label, onClick, variant = 'outline' }: AuthButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border text-sm font-medium transition-colors',
        variant === 'solid'
          ? 'border-accent bg-accent text-white hover:bg-accent-hover'
          : 'border-border bg-surface text-ink hover:bg-surface-muted',
      )}
    >
      <Icon size={18} strokeWidth={2} />
      {label}
    </button>
  )
}
```

- [ ] **Step 2: 替换 `src/routes/LoginScreen.tsx`**

```tsx
import { useNavigate } from 'react-router-dom'
import { Mail, Github, Chrome, ArrowRight, Bot } from 'lucide-react'
import { AuthButton } from '@/components/login/AuthButton'

export function LoginScreen() {
  const navigate = useNavigate()
  const enter = () => navigate('/app')

  return (
    <div className="flex h-screen">
      {/* 左侧大图标块 */}
      <div className="relative hidden w-1/2 items-center justify-center bg-accent-subtle md:flex">
        <div className="flex flex-col items-center gap-6">
          <div className="flex h-28 w-28 items-center justify-center rounded-3xl bg-accent shadow-float">
            <Bot size={64} className="text-white" strokeWidth={1.5} />
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold text-ink">hip</div>
            <div className="mt-1 text-sm text-ink-secondary">智能体编码工作台</div>
          </div>
        </div>
      </div>

      {/* 右侧登录方式 */}
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-semibold text-ink">登录到 hip</h1>
          <p className="mt-1.5 text-sm text-ink-secondary">选择一种方式继续</p>

          <div className="mt-8 flex flex-col gap-3">
            <AuthButton icon={Mail} label="使用邮箱登录" onClick={enter} variant="solid" />
            <AuthButton icon={Github} label="使用 GitHub 登录" onClick={enter} />
            <AuthButton icon={Chrome} label="使用 Google 登录" onClick={enter} />
          </div>

          <button
            onClick={enter}
            className="mt-6 flex w-full items-center justify-center gap-1.5 text-sm text-ink-tertiary transition-colors hover:text-ink-secondary"
          >
            跳过登录
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 类型检查**

Run: `yarn type-check`
Expected: 0 errors。

- [ ] **Step 4: 目视验证**

Run: `yarn dev` → http://localhost:1420
Expected: 登录页左半为强调色图标块（机器人图标 + hip 标题），右半为邮箱（实心）/ GitHub / Google 三个按钮 + 「跳过登录」链接；任意按钮均跳到 `/#/app`。Ctrl-C。

- [ ] **Step 5: Commit**

```bash
git add src/components/login/AuthButton.tsx src/routes/LoginScreen.tsx
git commit -m "feat(login): build login screen with email/github/google/skip"
```

---

### Task 9: 侧边栏外壳 — Sidebar + NewChatButton + SearchBox

**Files:**
- Create: `src/components/sidebar/NewChatButton.tsx`
- Create: `src/components/sidebar/SearchBox.tsx`
- Create: `src/components/sidebar/Sidebar.tsx`
- Modify: `src/routes/AppLayout.tsx`（临时挂载 Sidebar 以便目视）

- [ ] **Step 1: 创建 `src/components/sidebar/NewChatButton.tsx`**

```tsx
import { Plus } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

export function NewChatButton({ collapsed }: { collapsed: boolean }) {
  const newSession = useUiStore((s) => s.newSession)
  return (
    <button
      onClick={newSession}
      className={cn(
        'flex h-9 items-center gap-2 rounded-md bg-accent text-sm font-medium text-white transition-colors hover:bg-accent-hover',
        collapsed ? 'w-9 justify-center px-0' : 'w-full px-3',
      )}
      title="新对话"
    >
      <Plus size={18} />
      {!collapsed && <span>新对话</span>}
    </button>
  )
}
```

- [ ] **Step 2: 创建 `src/components/sidebar/SearchBox.tsx`**

```tsx
import { Search } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'

export function SearchBox() {
  const search = useUiStore((s) => s.search)
  const setSearch = useUiStore((s) => s.setSearch)
  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary" />
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索会话"
        className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-[13px] text-ink placeholder:text-ink-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      />
    </div>
  )
}
```

- [ ] **Step 3: 创建 `src/components/sidebar/Sidebar.tsx`**

> SessionList 与 UserMenu 在后续任务创建。本步骤先用占位 div，Task 10/11 替换。

```tsx
import { useUiStore } from '@/store/uiStore'
import { NewChatButton } from './NewChatButton'
import { SearchBox } from './SearchBox'

export function Sidebar() {
  const collapsed = useUiStore((s) => s.collapsed)

  return (
    <div className="flex h-full flex-col bg-surface-subtle">
      <div className="flex flex-col gap-2 p-2.5">
        <NewChatButton collapsed={collapsed} />
        {!collapsed && <SearchBox />}
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {!collapsed && <div className="py-2 text-[12px] text-ink-tertiary">会话列表占位</div>}
      </div>

      <div className="border-t border-border p-2.5">
        {!collapsed && <div className="text-[12px] text-ink-tertiary">用户菜单占位</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 临时挂载到 `src/routes/AppLayout.tsx`** 以便目视

```tsx
import { Sidebar } from '@/components/sidebar/Sidebar'

export function AppLayout() {
  return (
    <div className="flex h-screen">
      <div className="w-60 border-r border-border">
        <Sidebar />
      </div>
      <div className="flex-1 bg-surface" />
    </div>
  )
}
```

- [ ] **Step 5: 类型检查**

Run: `yarn type-check`
Expected: 0 errors。

- [ ] **Step 6: 目视验证**

Run: `yarn dev` → 跳过登录进入 `/app`
Expected: 左侧 240px 侧边栏，顶部「新对话」蓝色按钮 + 搜索框，中部/底部为占位文字。Ctrl-C。

- [ ] **Step 7: Commit**

```bash
git add src/components/sidebar/NewChatButton.tsx src/components/sidebar/SearchBox.tsx src/components/sidebar/Sidebar.tsx src/routes/AppLayout.tsx
git commit -m "feat(sidebar): add sidebar shell with new-chat button and search box"
```

---

### Task 10: 会话列表 — SessionList + SessionItem

**Files:**
- Create: `src/components/sidebar/SessionItem.tsx`
- Create: `src/components/sidebar/SessionList.tsx`
- Modify: `src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: 创建 `src/components/sidebar/SessionItem.tsx`**

```tsx
import { X } from 'lucide-react'
import type { MockSession } from '@/mock/types'
import { cn } from '@/lib/utils'

interface SessionItemProps {
  session: MockSession
  active: boolean
  onSelect: () => void
  onDelete: () => void
}

export function SessionItem({ session, active, onSelect, onDelete }: SessionItemProps) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        'group flex cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 transition-colors',
        active ? 'bg-accent-subtle' : 'hover:bg-surface-muted',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn('truncate text-[13px] font-medium', active ? 'text-accent' : 'text-ink')}>
          {session.title}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="hidden shrink-0 text-ink-tertiary hover:text-danger group-hover:block"
          title="删除会话"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] text-ink-tertiary">{session.preview}</span>
        <span className="shrink-0 text-[11px] text-ink-tertiary">{session.updatedAt}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 创建 `src/components/sidebar/SessionList.tsx`**

```tsx
import { useUiStore } from '@/store/uiStore'
import { filterSessions } from '@/lib/sessions'
import { SessionItem } from './SessionItem'

export function SessionList() {
  const sessions = useUiStore((s) => s.sessions)
  const search = useUiStore((s) => s.search)
  const activeSessionId = useUiStore((s) => s.activeSessionId)
  const selectSession = useUiStore((s) => s.selectSession)
  const deleteSession = useUiStore((s) => s.deleteSession)

  const filtered = filterSessions(sessions, search)

  if (filtered.length === 0) {
    return <div className="px-2.5 py-4 text-[12px] text-ink-tertiary">没有匹配的会话</div>
  }

  return (
    <div className="flex flex-col gap-0.5">
      {filtered.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          active={session.id === activeSessionId}
          onSelect={() => selectSession(session.id)}
          onDelete={() => deleteSession(session.id)}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: 修改 `src/components/sidebar/Sidebar.tsx`** — 用 SessionList 替换列表占位

把 import 区与中部列表区替换为：

```tsx
import { useUiStore } from '@/store/uiStore'
import { NewChatButton } from './NewChatButton'
import { SearchBox } from './SearchBox'
import { SessionList } from './SessionList'

export function Sidebar() {
  const collapsed = useUiStore((s) => s.collapsed)

  return (
    <div className="flex h-full flex-col bg-surface-subtle">
      <div className="flex flex-col gap-2 p-2.5">
        <NewChatButton collapsed={collapsed} />
        {!collapsed && <SearchBox />}
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {!collapsed && <SessionList />}
      </div>

      <div className="border-t border-border p-2.5">
        {!collapsed && <div className="text-[12px] text-ink-tertiary">用户菜单占位</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 类型检查**

Run: `yarn type-check`
Expected: 0 errors。

- [ ] **Step 5: 目视验证**

Run: `yarn dev` → `/app`
Expected: 侧边栏显示 8 条 mock 会话，首条选中（强调色背景）；hover 出现删除「×」；点击会话切换选中；搜索框输入「布局」实时过滤列表；点击「新对话」列表顶部插入「新对话」并选中。Ctrl-C。

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar/SessionItem.tsx src/components/sidebar/SessionList.tsx src/components/sidebar/Sidebar.tsx
git commit -m "feat(sidebar): add session list with selection, delete, and live search"
```

---

### Task 11: 用户菜单 — UserMenu（头像向上弹出）

**Files:**
- Create: `src/components/sidebar/UserMenu.tsx`
- Modify: `src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: 创建 `src/components/sidebar/UserMenu.tsx`**

```tsx
import { useNavigate } from 'react-router-dom'
import { User, Settings, CreditCard, HelpCircle, LogOut, ChevronsUpDown } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/DropdownMenu'
import { mockUser } from '@/mock/user'
import { cn } from '@/lib/utils'

const PAGES = [
  { icon: User, label: '个人资料' },
  { icon: Settings, label: '设置' },
  { icon: CreditCard, label: '账单与用量' },
  { icon: HelpCircle, label: '帮助与支持' },
]

export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-2.5 rounded-md p-1.5 transition-colors hover:bg-surface-muted',
            collapsed ? 'w-9 justify-center' : 'w-full',
          )}
        >
          <Avatar name={mockUser.name} src={mockUser.avatarUrl} size={28} />
          {!collapsed && (
            <>
              <div className="flex min-w-0 flex-1 flex-col items-start">
                <span className="truncate text-[13px] font-medium text-ink">{mockUser.name}</span>
                <span className="truncate text-[11px] text-ink-tertiary">{mockUser.email}</span>
              </div>
              <ChevronsUpDown size={14} className="shrink-0 text-ink-tertiary" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="w-[240px]">
        <DropdownMenuLabel>{mockUser.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PAGES.map((page) => (
          <DropdownMenuItem key={page.label}>
            <page.icon size={15} className="text-ink-secondary" />
            {page.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-danger focus:bg-danger/10" onSelect={() => navigate('/login')}>
          <LogOut size={15} />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 2: 修改 `src/components/sidebar/Sidebar.tsx`** — 用 UserMenu 替换底部占位

替换底部区块与 import：

```tsx
import { useUiStore } from '@/store/uiStore'
import { NewChatButton } from './NewChatButton'
import { SearchBox } from './SearchBox'
import { SessionList } from './SessionList'
import { UserMenu } from './UserMenu'

export function Sidebar() {
  const collapsed = useUiStore((s) => s.collapsed)

  return (
    <div className="flex h-full flex-col bg-surface-subtle">
      <div className="flex flex-col gap-2 p-2.5">
        <NewChatButton collapsed={collapsed} />
        {!collapsed && <SearchBox />}
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {!collapsed && <SessionList />}
      </div>

      <div className="border-t border-border p-2">
        <UserMenu collapsed={collapsed} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 类型检查**

Run: `yarn type-check`
Expected: 0 errors。

- [ ] **Step 4: 目视验证**

Run: `yarn dev` → `/app`
Expected: 侧边栏底部显示头像 + 用户名 + 邮箱；点击向上弹出菜单（个人资料/设置/账单/帮助/退出登录）；点击「退出登录」回到登录页。Ctrl-C。

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/UserMenu.tsx src/components/sidebar/Sidebar.tsx
git commit -m "feat(sidebar): add user menu with avatar and upward popup pages"
```

---

### Task 12: 对话区 — ChatHeader + StreamingCursor + MessageBubble + ChatPane

**Files:**
- Create: `src/components/chat/StreamingCursor.tsx`
- Create: `src/components/chat/MessageBubble.tsx`
- Create: `src/components/chat/ChatHeader.tsx`
- Create: `src/components/chat/ChatPane.tsx`
- Modify: `src/routes/AppLayout.tsx`（临时挂载对话区）

- [ ] **Step 1: 创建 `src/components/chat/StreamingCursor.tsx`**

```tsx
export function StreamingCursor() {
  return <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-blink bg-accent" />
}
```

- [ ] **Step 2: 创建 `src/components/chat/MessageBubble.tsx`**

```tsx
import ReactMarkdown from 'react-markdown'
import type { MockMessage } from '@/mock/types'
import { Avatar } from '@/components/ui/Avatar'
import { mockUser } from '@/mock/user'
import { StreamingCursor } from './StreamingCursor'
import { cn } from '@/lib/utils'

interface MessageBubbleProps {
  message: MockMessage
  streaming?: boolean
}

export function MessageBubble({ message, streaming }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div className="flex gap-3">
      {isUser ? (
        <Avatar name={mockUser.name} size={28} />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
          AI
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[12px] font-medium text-ink-secondary">{isUser ? '你' : 'hip'}</div>
        <div
          className={cn(
            'prose-sm max-w-none text-[14px] leading-relaxed text-ink',
            '[&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-surface-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[12.5px]',
            '[&_code]:font-mono [&_code]:text-[12.5px]',
            '[&_table]:my-2 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
            '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_p]:my-1.5',
          )}
        >
          <ReactMarkdown>{message.content}</ReactMarkdown>
          {streaming && <StreamingCursor />}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 创建 `src/components/chat/ChatHeader.tsx`**

```tsx
import { PanelLeft, PanelRight } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { Button } from '@/components/ui/Button'

export function ChatHeader() {
  const sessions = useUiStore((s) => s.sessions)
  const activeSessionId = useUiStore((s) => s.activeSessionId)
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed)
  const togglePanel = useUiStore((s) => s.togglePanel)

  const active = sessions.find((s) => s.id === activeSessionId)

  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
      <div className="flex items-center gap-2">
        <Button variant="icon" size="icon" onClick={toggleCollapsed} title="折叠侧边栏">
          <PanelLeft size={17} />
        </Button>
        <span className="text-[13px] font-medium text-ink">{active?.title ?? '对话'}</span>
      </div>
      <Button variant="icon" size="icon" onClick={togglePanel} title="切换产物面板">
        <PanelRight size={17} />
      </Button>
    </div>
  )
}
```

- [ ] **Step 4: 创建 `src/components/chat/ChatPane.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { useUiStore } from '@/store/uiStore'
import { MessageBubble } from './MessageBubble'

export function ChatPane() {
  const activeSessionId = useUiStore((s) => s.activeSessionId)
  const messages = useUiStore((s) => s.messagesBySession[s.activeSessionId] ?? [])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-ink-tertiary">
        发送一条消息开始对话
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-6">
        {messages.map((m, i) => (
          <MessageBubble
            key={`${activeSessionId}-${m.id}-${i}`}
            message={m}
            streaming={false}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: 临时挂载到 `src/routes/AppLayout.tsx`**

```tsx
import { Sidebar } from '@/components/sidebar/Sidebar'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatPane } from '@/components/chat/ChatPane'

export function AppLayout() {
  return (
    <div className="flex h-screen">
      <div className="w-60 border-r border-border">
        <Sidebar />
      </div>
      <div className="flex flex-1 flex-col bg-surface">
        <ChatHeader />
        <ChatPane />
      </div>
    </div>
  )
}
```

- [ ] **Step 6: 类型检查**

Run: `yarn type-check`
Expected: 0 errors。

- [ ] **Step 7: 目视验证**

Run: `yarn dev` → `/app`
Expected: 中间区顶部为标题栏（含折叠/面板按钮），下方显示首个会话的 mock 对话：用户提问气泡 + 助手 markdown 回复（含代码块渲染）。切换到其他会话显示「发送一条消息开始对话」。Ctrl-C。

- [ ] **Step 8: Commit**

```bash
git add src/components/chat/StreamingCursor.tsx src/components/chat/MessageBubble.tsx src/components/chat/ChatHeader.tsx src/components/chat/ChatPane.tsx src/routes/AppLayout.tsx
git commit -m "feat(chat): add chat header, message bubbles with markdown, and chat pane"
```

---

### Task 13: 输入框 + 模拟流式 — tokenize + useSimulatedStream + InputBar

**Files:**
- Create: `src/lib/stream.ts`
- Create: `src/lib/stream.test.ts`
- Create: `src/hooks/useSimulatedStream.ts`
- Create: `src/components/chat/InputBar.tsx`
- Modify: `src/components/chat/ChatPane.tsx`（标记最后一条 assistant 为 streaming）
- Modify: `src/routes/AppLayout.tsx`（挂载 InputBar）

- [ ] **Step 1: 创建 `src/lib/stream.ts`**

```ts
// 把文本切成用于「逐字流式」的小块（按字符，保留空白）
export function tokenize(text: string, chunkSize = 2): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize))
  }
  return chunks
}
```

- [ ] **Step 2: 写失败测试 `src/lib/stream.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { tokenize } from './stream'

describe('tokenize', () => {
  it('splits text into chunks of given size', () => {
    expect(tokenize('abcd', 2)).toEqual(['ab', 'cd'])
  })

  it('keeps remainder in a final shorter chunk', () => {
    expect(tokenize('abcde', 2)).toEqual(['ab', 'cd', 'e'])
  })

  it('rejoins to the original text', () => {
    const text = 'hello world 你好'
    expect(tokenize(text, 3).join('')).toBe(text)
  })

  it('returns empty array for empty string', () => {
    expect(tokenize('', 2)).toEqual([])
  })
})
```

- [ ] **Step 3: 运行测试**

Run: `yarn test src/lib/stream.test.ts`
Expected: 4 个测试 PASS。

- [ ] **Step 4: 创建 `src/hooks/useSimulatedStream.ts`**

> 这个 hook 模拟「发送消息 → 助手逐字回复 + 4 个 agent 并行 running→done」。用 `window.setTimeout` 串起时间线，组件卸载时清理。

```ts
import { useEffect, useRef } from 'react'
import { useUiStore } from '@/store/uiStore'
import { tokenize } from '@/lib/stream'
import { seedAgents } from '@/mock/agents'
import { CANNED_REPLY } from '@/mock/messages'
import type { MockMessage } from '@/mock/types'

let counter = 0
function makeId(): string {
  counter += 1
  return `gen-${counter}`
}

export function useSimulatedStream() {
  const timers = useRef<number[]>([])

  useEffect(() => {
    const t = timers.current
    return () => {
      t.forEach((id) => window.clearTimeout(id))
    }
  }, [])

  function schedule(fn: () => void, delay: number) {
    const id = window.setTimeout(fn, delay)
    timers.current.push(id)
  }

  function send(text: string) {
    const store = useUiStore.getState()
    const sessionId = store.activeSessionId

    // 1. 用户消息
    const userMsg: MockMessage = { id: makeId(), role: 'user', content: text }
    store.appendMessage(sessionId, userMsg)

    // 2. 空助手消息（流式填充）
    const assistantMsg: MockMessage = { id: makeId(), role: 'assistant', content: '' }
    store.appendMessage(sessionId, assistantMsg)

    // 3. seed agents 并切到「智能体」tab
    store.setAgents(seedAgents())
    store.setTab('agents')
    if (!store.panelOpen) store.togglePanel()

    // 4. agent 并行状态机：planner/coder/reviewer 依次 running（并填入 token 文本），最后 done
    schedule(() => {
      const s = useUiStore.getState()
      s.setAgentStatus('a1', 'running')
      s.appendAgentTokens('a1', '拆解任务边界：3 个子模块。')
    }, 300)
    schedule(() => {
      const s = useUiStore.getState()
      s.setAgentStatus('a2', 'running')
      s.appendAgentTokens('a2', '生成实现代码与组合层。')
    }, 600)
    schedule(() => {
      const s = useUiStore.getState()
      s.setAgentStatus('a3', 'running')
      s.appendAgentTokens('a3', '审查边界条件与正确性。')
    }, 900)
    schedule(() => {
      const s = useUiStore.getState()
      s.appendAgentTokens('a0', '任务较复杂，分发 3 个子 agent 并行。')
      s.setAgentStatus('a0', 'done')
    }, 1000)
    schedule(() => useUiStore.getState().setAgentStatus('a1', 'done'), 2000)
    schedule(() => useUiStore.getState().setAgentStatus('a3', 'done'), 2400)

    // 5. 逐字流式助手回复
    const chunks = tokenize(CANNED_REPLY, 2)
    chunks.forEach((chunk, i) => {
      schedule(() => useUiStore.getState().appendToLastAssistant(sessionId, chunk), 1000 + i * 28)
    })

    // 6. 收尾：coder done
    const total = 1000 + chunks.length * 28
    schedule(() => useUiStore.getState().setAgentStatus('a2', 'done'), total + 200)
  }

  return { send }
}
```

- [ ] **Step 5: 创建 `src/components/chat/InputBar.tsx`**

```tsx
import { useState } from 'react'
import { ArrowUp, ChevronDown } from 'lucide-react'
import { Textarea } from '@/components/ui/Textarea'
import { useSimulatedStream } from '@/hooks/useSimulatedStream'

const MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'gpt-4o']

export function InputBar() {
  const [value, setValue] = useState('')
  const [model, setModel] = useState(MODELS[0])
  const { send } = useSimulatedStream()

  function submit() {
    const text = value.trim()
    if (!text) return
    send(text)
    setValue('')
  }

  return (
    <div className="shrink-0 px-5 pb-5">
      <div className="mx-auto max-w-3xl rounded-xl border border-border bg-surface p-2 shadow-pop focus-within:ring-2 focus-within:ring-accent/30">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
          placeholder="给 hip 发消息…（Enter 发送，Shift+Enter 换行）"
          className="border-0 px-2 py-1 focus-visible:ring-0"
        />
        <div className="flex items-center justify-between px-1 pt-1">
          <label className="flex items-center gap-1 text-[12px] text-ink-secondary">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="cursor-pointer appearance-none bg-transparent pr-4 text-[12px] text-ink-secondary focus:outline-none"
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="-ml-4 pointer-events-none text-ink-tertiary" />
          </label>
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            title="发送"
          >
            <ArrowUp size={17} />
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: 修改 `src/components/chat/ChatPane.tsx`** — 最后一条 assistant 显示流式光标

把 `messages.map(...)` 中的 `MessageBubble` 改为根据「是否最后一条 assistant」决定 `streaming`：

```tsx
        {messages.map((m, i) => (
          <MessageBubble
            key={`${activeSessionId}-${m.id}-${i}`}
            message={m}
            streaming={m.role === 'assistant' && i === messages.length - 1}
          />
        ))}
```

> 说明：mock 演示里把「最后一条助手消息」始终显示闪烁光标，体现实时感；这是纯展示效果，不影响内容。

- [ ] **Step 7: 挂载 InputBar 到 `src/routes/AppLayout.tsx`**

```tsx
import { Sidebar } from '@/components/sidebar/Sidebar'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatPane } from '@/components/chat/ChatPane'
import { InputBar } from '@/components/chat/InputBar'

export function AppLayout() {
  return (
    <div className="flex h-screen">
      <div className="w-60 border-r border-border">
        <Sidebar />
      </div>
      <div className="flex flex-1 flex-col bg-surface">
        <ChatHeader />
        <ChatPane />
        <InputBar />
      </div>
    </div>
  )
}
```

- [ ] **Step 8: 类型检查 + 单测**

Run: `yarn type-check && yarn test`
Expected: type-check 0 errors；所有单测 PASS。

- [ ] **Step 9: 目视验证**

Run: `yarn dev` → `/app`
Expected: 底部输入框带模型下拉 + 发送按钮；输入文字回车后，出现用户气泡 + 助手逐字打出回复 + 末尾闪烁光标。Ctrl-C。

- [ ] **Step 10: Commit**

```bash
git add src/lib/stream.ts src/lib/stream.test.ts src/hooks/useSimulatedStream.ts src/components/chat/InputBar.tsx src/components/chat/ChatPane.tsx src/routes/AppLayout.tsx
git commit -m "feat(chat): add input bar with simulated streaming and parallel agent state machine"
```

---

### Task 14: 产物面板外壳 — ArtifactPanel（Tabs + toggle + 全屏）

**Files:**
- Create: `src/components/artifact/ArtifactPanel.tsx`
- Modify: `src/routes/AppLayout.tsx`（临时挂载右侧面板）

> DocRenderer / FileTree / AgentDashboard / DiffViewer 在 Task 15-18 创建。本步骤先用占位，逐个替换。

- [ ] **Step 1: 创建 `src/components/artifact/ArtifactPanel.tsx`**

```tsx
import { FileText, FolderTree, Network, GitCompare, Maximize2, Minimize2, X } from 'lucide-react'
import type { ArtifactTab } from '@/mock/types'
import { useUiStore } from '@/store/uiStore'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

const TABS: { value: ArtifactTab; label: string; icon: typeof FileText }[] = [
  { value: 'doc', label: '文档', icon: FileText },
  { value: 'files', label: '文件', icon: FolderTree },
  { value: 'agents', label: '智能体', icon: Network },
  { value: 'diff', label: 'Diff', icon: GitCompare },
]

export function ArtifactPanel() {
  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  const fullscreen = useUiStore((s) => s.panelFullscreen)
  const toggleFullscreen = useUiStore((s) => s.toggleFullscreen)
  const togglePanel = useUiStore((s) => s.togglePanel)

  const body = (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setTab(v as ArtifactTab)}
      className="flex h-full flex-col"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-2">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              <t.icon size={14} />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex items-center gap-0.5">
          <Button variant="icon" size="icon" onClick={toggleFullscreen} title={fullscreen ? '还原' : '全屏'}>
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </Button>
          <Button variant="icon" size="icon" onClick={togglePanel} title="关闭面板">
            <X size={16} />
          </Button>
        </div>
      </div>

      <TabsContent value="doc" className="p-4">文档占位</TabsContent>
      <TabsContent value="files" className="p-2">文件树占位</TabsContent>
      <TabsContent value="agents" className="p-3">智能体占位</TabsContent>
      <TabsContent value="diff" className="p-0">Diff 占位</TabsContent>
    </Tabs>
  )

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/20 p-6">
        <div className="h-full w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-surface shadow-float">
          {body}
        </div>
      </div>
    )
  }

  return <div className={cn('h-full border-l border-border bg-surface-subtle')}>{body}</div>
}
```

- [ ] **Step 2: 临时挂载到 `src/routes/AppLayout.tsx`**（在中间区右侧加固定宽度面板）

```tsx
import { Sidebar } from '@/components/sidebar/Sidebar'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatPane } from '@/components/chat/ChatPane'
import { InputBar } from '@/components/chat/InputBar'
import { ArtifactPanel } from '@/components/artifact/ArtifactPanel'
import { useUiStore } from '@/store/uiStore'

export function AppLayout() {
  const panelOpen = useUiStore((s) => s.panelOpen)
  return (
    <div className="flex h-screen">
      <div className="w-60 border-r border-border">
        <Sidebar />
      </div>
      <div className="flex flex-1 flex-col bg-surface">
        <ChatHeader />
        <ChatPane />
        <InputBar />
      </div>
      {panelOpen && (
        <div className="w-[400px]">
          <ArtifactPanel />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 类型检查**

Run: `yarn type-check`
Expected: 0 errors。

- [ ] **Step 4: 目视验证**

Run: `yarn dev` → `/app`
Expected: 右侧 400px 面板，顶部 4 个 tab（文档/文件/智能体/Diff）可切换显示对应占位；全屏按钮把面板放大为居中浮层 + 半透明遮罩；关闭按钮（×）隐藏面板，点中间标题栏的面板按钮可重新打开。Ctrl-C。

- [ ] **Step 5: Commit**

```bash
git add src/components/artifact/ArtifactPanel.tsx src/routes/AppLayout.tsx
git commit -m "feat(artifact): add artifact panel shell with tabs, fullscreen, and toggle"
```

---

### Task 15: 文档渲染 — DocRenderer

**Files:**
- Create: `src/components/artifact/DocRenderer.tsx`
- Modify: `src/components/artifact/ArtifactPanel.tsx`

- [ ] **Step 1: 创建 `src/components/artifact/DocRenderer.tsx`**

```tsx
import ReactMarkdown from 'react-markdown'
import { mockDoc } from '@/mock/doc'

export function DocRenderer() {
  return (
    <article
      className="
        max-w-none text-[14px] leading-relaxed text-ink
        [&_h1]:mb-3 [&_h1]:mt-1 [&_h1]:text-[20px] [&_h1]:font-semibold
        [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-[16px] [&_h2]:font-semibold
        [&_p]:my-2
        [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5
        [&_pre]:my-3 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-surface-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[12.5px]
        [&_code]:font-mono
        [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-3 [&_blockquote]:text-ink-secondary
        [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse
        [&_th]:border [&_th]:border-border [&_th]:bg-surface-muted [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left
        [&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5
      "
    >
      <ReactMarkdown>{mockDoc}</ReactMarkdown>
    </article>
  )
}
```

- [ ] **Step 2: 修改 `src/components/artifact/ArtifactPanel.tsx`** — 替换文档占位

把 `import` 区加入 DocRenderer，并替换 doc 的 `TabsContent`：

```tsx
import { DocRenderer } from './DocRenderer'
```

```tsx
      <TabsContent value="doc" className="p-4">
        <DocRenderer />
      </TabsContent>
```

- [ ] **Step 3: 类型检查**

Run: `yarn type-check`
Expected: 0 errors。

- [ ] **Step 4: 目视验证**

Run: `yarn dev` → `/app` → 右侧「文档」tab
Expected: 渲染 markdown 文档：标题、表格（带边框）、代码块（灰底等宽）、引用块（左边框）。Ctrl-C。

- [ ] **Step 5: Commit**

```bash
git add src/components/artifact/DocRenderer.tsx src/components/artifact/ArtifactPanel.tsx
git commit -m "feat(artifact): add markdown document renderer"
```

---

### Task 16: 文件树 — FileTree

**Files:**
- Create: `src/components/artifact/FileTree.tsx`
- Modify: `src/components/artifact/ArtifactPanel.tsx`

- [ ] **Step 1: 创建 `src/components/artifact/FileTree.tsx`**

```tsx
import { useState } from 'react'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react'
import type { FileNode } from '@/mock/types'
import { mockFileTree } from '@/mock/fileTree'
import { cn } from '@/lib/utils'

interface TreeNodeProps {
  node: FileNode
  depth: number
  selected: string
  onSelect: (path: string) => void
}

function TreeNode({ node, depth, selected, onSelect }: TreeNodeProps) {
  const [open, setOpen] = useState(true)
  const isDir = node.type === 'dir'
  const isSelected = selected === node.path

  return (
    <div>
      <div
        onClick={() => (isDir ? setOpen((v) => !v) : onSelect(node.path))}
        className={cn(
          'flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-[13px] transition-colors',
          isSelected ? 'bg-accent-subtle text-accent' : 'text-ink hover:bg-surface-muted',
        )}
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        {isDir ? (
          <>
            {open ? <ChevronDown size={14} className="text-ink-tertiary" /> : <ChevronRight size={14} className="text-ink-tertiary" />}
            {open ? <FolderOpen size={15} className="text-accent" /> : <Folder size={15} className="text-accent" />}
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <File size={15} className="text-ink-tertiary" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {isDir && open && node.children?.map((child) => (
        <TreeNode key={child.path} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
      ))}
    </div>
  )
}

export function FileTree() {
  const [selected, setSelected] = useState('')
  return (
    <div className="py-1">
      <TreeNode node={mockFileTree} depth={0} selected={selected} onSelect={setSelected} />
    </div>
  )
}
```

- [ ] **Step 2: 修改 `src/components/artifact/ArtifactPanel.tsx`** — 替换文件树占位

```tsx
import { FileTree } from './FileTree'
```

```tsx
      <TabsContent value="files" className="p-2">
        <FileTree />
      </TabsContent>
```

- [ ] **Step 3: 类型检查**

Run: `yarn type-check`
Expected: 0 errors。

- [ ] **Step 4: 目视验证**

Run: `yarn dev` → `/app` → 右侧「文件」tab
Expected: 显示嵌套目录树，文件夹可展开/折叠（图标切换），点击文件高亮选中。Ctrl-C。

- [ ] **Step 5: Commit**

```bash
git add src/components/artifact/FileTree.tsx src/components/artifact/ArtifactPanel.tsx
git commit -m "feat(artifact): add collapsible file tree"
```

---

### Task 17: 智能体并行面板 — AgentDashboard

**Files:**
- Create: `src/components/artifact/AgentDashboard.tsx`
- Modify: `src/components/artifact/ArtifactPanel.tsx`

- [ ] **Step 1: 创建 `src/components/artifact/AgentDashboard.tsx`**

```tsx
import type { MockAgent, Role } from '@/mock/types'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

const ROLE_COLOR: Record<Role, string> = {
  supervisor: 'var(--role-supervisor)',
  planner: 'var(--role-planner)',
  coder: 'var(--role-coder)',
  reviewer: 'var(--role-reviewer)',
}

function StatusDot({ status, color }: { status: MockAgent['status']; color: string }) {
  if (status === 'running') {
    return <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: color }} />
  }
  if (status === 'done') {
    return <span className="h-2 w-2 rounded-full bg-ink-tertiary" />
  }
  return <span className="h-2 w-2 rounded-full border border-border" />
}

function AgentCard({ agent }: { agent: MockAgent }) {
  const color = ROLE_COLOR[agent.role]
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border bg-surface p-3 transition-colors',
        agent.status === 'running' ? 'border-accent/40' : 'border-border',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          <span className="text-[13px] font-semibold text-ink">{agent.title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusDot status={agent.status} color={color} />
          <span className="text-[11px] capitalize text-ink-tertiary">{agent.status}</span>
        </div>
      </div>

      <div className="min-h-[32px] rounded-md bg-surface-muted px-2.5 py-1.5 text-[12px] leading-snug text-ink-secondary">
        {agent.tokens || <span className="text-ink-tertiary">等待中…</span>}
      </div>

      <div className="flex items-center gap-3 text-[11px] text-ink-tertiary">
        <span>{agent.tokenCount} tokens</span>
        <span>{(agent.elapsedMs / 1000).toFixed(1)}s</span>
      </div>
    </div>
  )
}

export function AgentDashboard() {
  const agents = useUiStore((s) => s.agents)
  const supervisor = agents.find((a) => a.role === 'supervisor')
  const children = agents.filter((a) => a.role !== 'supervisor')

  return (
    <div className="flex flex-col gap-3">
      {supervisor && <AgentCard agent={supervisor} />}
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">并行子智能体</div>
      <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
        {children.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 修改 `src/components/artifact/ArtifactPanel.tsx`** — 替换智能体占位

```tsx
import { AgentDashboard } from './AgentDashboard'
```

```tsx
      <TabsContent value="agents" className="p-3">
        <AgentDashboard />
      </TabsContent>
```

- [ ] **Step 3: 类型检查**

Run: `yarn type-check`
Expected: 0 errors。

- [ ] **Step 4: 目视验证**

Run: `yarn dev` → `/app` → 右侧「智能体」tab
Expected: 顶部 supervisor 卡片 + 下方 planner/coder/reviewer 卡片网格，每张含角色色点、状态徽章、token 片段、token 数与耗时。在输入框发送消息后，切回此 tab 可见 agent 依次 running（脉冲点）→ done。Ctrl-C。

- [ ] **Step 5: Commit**

```bash
git add src/components/artifact/AgentDashboard.tsx src/components/artifact/ArtifactPanel.tsx
git commit -m "feat(artifact): add parallel agent dashboard with live status"
```

---

### Task 18: Git Diff 渲染 — DiffViewer

**Files:**
- Create: `src/components/artifact/DiffViewer.tsx`
- Modify: `src/components/artifact/ArtifactPanel.tsx`

- [ ] **Step 1: 创建 `src/components/artifact/DiffViewer.tsx`**

```tsx
import type { DiffFile, DiffLine } from '@/mock/types'
import { mockDiff } from '@/mock/diff'
import { cn } from '@/lib/utils'

function lineStyle(type: DiffLine['type']): string {
  if (type === 'add') return 'bg-success/10'
  if (type === 'del') return 'bg-danger/10'
  return ''
}

function sign(type: DiffLine['type']): string {
  if (type === 'add') return '+'
  if (type === 'del') return '-'
  return ' '
}

function FileDiff({ file }: { file: DiffFile }) {
  return (
    <div className="border-b border-border">
      <div className="flex items-center justify-between bg-surface-muted px-3 py-2">
        <span className="font-mono text-[12px] text-ink">{file.path}</span>
        <span className="flex items-center gap-2 text-[11px]">
          <span className="text-success">+{file.additions}</span>
          <span className="text-danger">-{file.deletions}</span>
        </span>
      </div>
      <div className="overflow-x-auto font-mono text-[12.5px] leading-relaxed">
        {file.lines.map((line, i) => (
          <div key={i} className={cn('flex', lineStyle(line.type))}>
            <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{line.oldNo ?? ''}</span>
            <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{line.newNo ?? ''}</span>
            <span
              className={cn(
                'w-4 shrink-0 select-none text-center',
                line.type === 'add' && 'text-success',
                line.type === 'del' && 'text-danger',
              )}
            >
              {sign(line.type)}
            </span>
            <span className="whitespace-pre px-1 text-ink">{line.content}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DiffViewer() {
  return (
    <div>
      {mockDiff.map((file) => (
        <FileDiff key={file.path} file={file} />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: 修改 `src/components/artifact/ArtifactPanel.tsx`** — 替换 Diff 占位

```tsx
import { DiffViewer } from './DiffViewer'
```

```tsx
      <TabsContent value="diff" className="p-0">
        <DiffViewer />
      </TabsContent>
```

- [ ] **Step 3: 类型检查**

Run: `yarn type-check`
Expected: 0 errors。

- [ ] **Step 4: 目视验证**

Run: `yarn dev` → `/app` → 右侧「Diff」tab
Expected: 显示两个文件的 diff，文件头含 +/- 计数；新增行绿底、删除行红底、上下文行无底色；左侧双列行号 + 中间 +/-/空 标记。Ctrl-C。

- [ ] **Step 5: Commit**

```bash
git add src/components/artifact/DiffViewer.tsx src/components/artifact/ArtifactPanel.tsx
git commit -m "feat(artifact): add line-level git diff viewer"
```

---

### Task 19: 组装三栏可拖拽布局 + 最终验证

**Files:**
- Modify: `src/routes/AppLayout.tsx`

> 把临时的固定宽度布局换成 `react-resizable-panels` 三栏：侧边栏可拖拽 + 折叠，右侧面板可拖拽 + toggle，中间自适应。百分比按 ~1800px 窗口宽度调校（侧栏 240px≈14%，右栏 400px≈26%）。

- [ ] **Step 1: 替换 `src/routes/AppLayout.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { useUiStore } from '@/store/uiStore'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatPane } from '@/components/chat/ChatPane'
import { InputBar } from '@/components/chat/InputBar'
import { ArtifactPanel } from '@/components/artifact/ArtifactPanel'

export function AppLayout() {
  const sidebarRef = useRef<ImperativePanelHandle>(null)
  const panelRef = useRef<ImperativePanelHandle>(null)
  const collapsed = useUiStore((s) => s.collapsed)
  const panelOpen = useUiStore((s) => s.panelOpen)
  const setCollapsed = useUiStore((s) => s.setCollapsed)

  // 侧边栏折叠 ↔ store.collapsed 双向同步
  useEffect(() => {
    const p = sidebarRef.current
    if (!p) return
    if (collapsed && !p.isCollapsed()) p.collapse()
    if (!collapsed && p.isCollapsed()) p.expand()
  }, [collapsed])

  // 右侧面板开关 ↔ store.panelOpen
  useEffect(() => {
    const p = panelRef.current
    if (!p) return
    if (!panelOpen && !p.isCollapsed()) p.collapse()
    if (panelOpen && p.isCollapsed()) p.expand()
  }, [panelOpen])

  return (
    <div className="h-screen w-screen overflow-hidden bg-surface">
      <PanelGroup direction="horizontal" autoSaveId="hip-layout">
        <Panel
          ref={sidebarRef}
          defaultSize={14}
          minSize={12}
          maxSize={22}
          collapsible
          collapsedSize={4}
          onCollapse={() => setCollapsed(true)}
          onExpand={() => setCollapsed(false)}
        >
          <Sidebar />
        </Panel>

        <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-accent data-[resize-handle-state=drag]:bg-accent" />

        <Panel minSize={34}>
          <div className="flex h-full flex-col bg-surface">
            <ChatHeader />
            <ChatPane />
            <InputBar />
          </div>
        </Panel>

        <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-accent data-[resize-handle-state=drag]:bg-accent" />

        <Panel
          ref={panelRef}
          defaultSize={26}
          minSize={18}
          maxSize={44}
          collapsible
          collapsedSize={0}
        >
          <ArtifactPanel />
        </Panel>
      </PanelGroup>
    </div>
  )
}
```

> 注意：`ArtifactPanel` 全屏态用 `fixed inset-0` 浮层渲染，不受 PanelGroup 宽度约束，因此与可拖拽布局不冲突。侧边栏折叠到 ~4% 时，`Sidebar` 内部已按 `collapsed` 渲染图标态（新对话图标按钮 + 头像），无搜索框与列表。

- [ ] **Step 2: 类型检查 + 全部单测**

Run: `yarn type-check && yarn test`
Expected: type-check 0 errors；所有单测 PASS。

- [ ] **Step 3: 完整交互目视验证（逐项核对）**

Run: `yarn dev` → http://localhost:1420

逐项确认：
- [ ] 登录页：左图标块 + 右侧 邮箱/GitHub/Google/跳过，任意进入 `/app`
- [ ] 三栏拖拽：拖动两个分隔条可调整侧栏与右栏宽度
- [ ] 侧栏折叠：点标题栏 PanelLeft 图标，侧栏收成图标条（新对话图标 + 头像），再点展开
- [ ] 会话：点击切换、hover 删除、搜索过滤、新对话置顶
- [ ] 头像菜单：点击向上弹出页面列表，退出登录回登录页
- [ ] 发送消息：用户气泡 + 助手逐字流式 + 末尾光标
- [ ] 右侧 4 tab：文档（markdown）、文件树（展开/选中）、智能体（发送后并行 running→done）、Diff（绿增红删）
- [ ] 面板 toggle：标题栏 PanelRight 图标 / 面板内 × 关闭与重开
- [ ] 面板全屏：Maximize 放大为居中浮层，Minimize 还原

Ctrl-C 退出。

- [ ] **Step 4: 清理验证 — 确认旧逻辑层未被引用**

Run: `yarn build`
Expected: `tsc && vite build` 成功产出 `dist/`，无类型错误。（旧 `AppShell`/`useWebSocket` 仍在磁盘但未被 `App.tsx` 引用，不影响构建。）

- [ ] **Step 5: Commit**

```bash
git add src/routes/AppLayout.tsx
git commit -m "feat(layout): assemble resizable three-column layout with collapse and toggle"
```

---

## Post-implementation checklist

全部任务完成后：

- [ ] `yarn type-check` — 0 errors
- [ ] `yarn test` — 全部 PASS（cn / mock / filterSessions / tokenize）
- [ ] `yarn build` — 构建成功
- [ ] `yarn dev` → 登录页 → 主界面，Task 19 Step 3 的交互清单逐项通过
- [ ] 旧逻辑层（`sessionStore`、`ws-client`、`useWebSocket`、`layout/`、`session/`）保留在磁盘但未挂载

## Out of Scope（不在本计划内）

- 真实鉴权 / OAuth；真实 WebSocket / sidecar 数据
- 暗色主题；响应式 / 移动端
- 状态持久化（刷新回到初始 mock）
- 真实文件系统 / git 集成
- 接回逻辑层（后续单独计划）
