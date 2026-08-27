# 终端文件面板导航增强 Spec

- 系列：`docs/design/terminal-file-navigation/`
- 状态：待评审
- 日期：2026-08-27
- 前置基线：
  - `src/components/terminals/TerminalFileTree.tsx`（终端文件树组件）
  - `src/components/terminals/TerminalFilesPanel.tsx`（终端文件面板）
  - `src/store/terminalFsStore.ts`（终端文件系统状态管理）
  - `src/components/terminals/sftpActions.ts`（SFTP 操作）
  - `src/components/terminals/termFsActions.ts`（本地文件系统操作）
- 涉及模块：
  - `src/components/terminals/TerminalFileTree.tsx`（文件树组件增强）
  - `src/store/terminalFsStore.ts`（状态管理扩展）
  - `src/components/terminals/TerminalFilesPanel.tsx`（面板 UI 增强）
  - `src/components/terminals/sftpActions.ts`（SFTP 导航操作）
  - `src/components/terminals/termFsActions.ts`（本地文件系统导航操作）

---

## 1. 根因：文件面板导航能力缺失

### 1.1 现状分析

当前终端文件面板（右侧面板）存在以下导航限制：

| # | 现象 | 代码证据 | 根因 |
|---|------|----------|------|
| A1 | 无法返回上一层目录 | `TerminalFileTree.tsx` 无父目录导航按钮 | 缺少父目录导航功能 |
| A2 | 无法快速跳转到指定路径 | `TerminalFileTree.tsx` 无路径输入框 | 缺少路径跳转功能 |
| A3 | 无法查看当前完整路径 | `TerminalFileTree.tsx` 仅显示根目录名称 | 路径显示不完整 |
| A4 | 导航历史丢失 | `terminalFsStore.ts` 无历史记录 | 缺少导航历史功能 |

### 1.2 用户场景

1. **场景 1：返回上一层**
   - 用户在 `/home/user/projects/deep/nested/dir` 目录
   - 需要返回上一层 `/home/user/projects/deep/nested`
   - 当前：需要关闭面板重新打开或手动展开父目录
   - 期望：点击"返回上一层"按钮直接导航

2. **场景 2：跳转到指定路径**
   - 用户需要跳转到 `/var/log` 目录
   - 当前：需要从根目录逐层展开
   - 期望：输入路径直接跳转

3. **场景 3：查看完整路径**
   - 用户在 `/home/user/projects/deep/nested/dir` 目录
   - 需要知道当前完整路径
   - 当前：仅显示根目录名称
   - 期望：显示完整路径或可点击的面包屑

---

## 2. 行业最佳实践参考

| 方案 | 关键机制 | 对照 hip 的启示 |
|------|----------|-----------------|
| **VS Code 文件资源管理器** | 面包屑导航 + 路径输入框 + 后退/前进按钮 | 完整的导航体验 |
| **macOS Finder** | 路径栏 + 后退/前进 + 路径面包屑 | 直观的导航方式 |
| **Windows 文件资源管理器** | 地址栏 + 后退/前进 + 面包屑 | 多种导航方式 |
| **Total Commander** | 双面板 + 快速目录跳转 + 历史记录 | 高效的文件管理 |
| **ranger (终端文件管理器)** | vim-like 导航 + 书签 + 历史 | 终端环境下的高效导航 |

---

## 3. 改进项

### T1 面包屑导航（P0 核心）

#### 3.1 面包屑组件设计

在文件树顶部添加面包屑导航，显示当前路径的层级结构：

```
[根目录] > [子目录1] > [子目录2] > [当前目录]
```

**特性：**
- 每个路径片段可点击，直接跳转到该目录
- 当前目录高亮显示
- 路径过长时自动折叠中间部分
- 支持鼠标悬停显示完整路径

#### 3.2 实现方案

```tsx
// 新增组件：TerminalBreadcrumb.tsx
interface TerminalBreadcrumbProps {
  terminalId: string
  currentPath: string
  backend: TerminalFileTreeBackend
  onNavigate: (path: string) => void
}

function TerminalBreadcrumb({ terminalId, currentPath, backend, onNavigate }: TerminalBreadcrumbProps) {
  const pathParts = useMemo(() => {
    if (!currentPath) return []
    const parts = currentPath.split('/').filter(Boolean)
    return parts.map((part, index) => ({
      name: part,
      path: '/' + parts.slice(0, index + 1).join('/'),
      isLast: index === parts.length - 1
    }))
  }, [currentPath])

  return (
    <div className="flex items-center gap-1 px-2 py-1 text-caption text-ink-tertiary overflow-x-auto">
      {pathParts.map((part, index) => (
        <React.Fragment key={part.path}>
          {index > 0 && <span className="text-ink-tertiary/50">/</span>}
          <button
            onClick={() => onNavigate(part.path)}
            className={cn(
              "hover:text-ink-secondary hover:underline whitespace-nowrap",
              part.isLast && "text-ink-secondary font-medium"
            )}
          >
            {part.name}
          </button>
        </React.Fragment>
      ))}
    </div>
  )
}
```

### T2 返回上一层按钮（P0 核心）

#### 3.3 父目录导航功能

在文件树工具栏添加"返回上一层"按钮：

**功能特性：**
- 点击按钮导航到当前目录的父目录
- 在根目录时禁用按钮
- 快捷键支持（Alt+↑ 或 Backspace）

#### 3.4 实现方案

```tsx
// 在 TerminalFileTree.tsx 中添加
function TerminalFileTree({ terminalId, initialPath, backend = 'sftp' }: TerminalFileTreeProps) {
  const currentPath = useTerminalFsStore((s) => s.byTerminal[terminalId]?.rootPath ?? null)
  
  const navigateToParent = useCallback(() => {
    if (!currentPath || currentPath === '/') return
    const parentPath = getParentPath(currentPath)
    if (backend === 'local') {
      void loadLocalDir(terminalId, parentPath)
    } else {
      void loadSftpDir(terminalId, parentPath)
    }
    // 更新根路径
    useTerminalFsStore.getState().setRootPath(terminalId, parentPath)
  }, [terminalId, currentPath, backend])

  const canGoUp = currentPath && currentPath !== '/'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工具栏 */}
      <div className="flex h-8 shrink-0 items-center justify-between gap-1 border-b border-border/80 px-2">
        <div className="flex items-center gap-0.5">
          {/* 返回上一层按钮 */}
          <button
            onClick={navigateToParent}
            disabled={!canGoUp}
            title="返回上一层 (Alt+↑)"
            className="rounded-md p-1 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink disabled:opacity-50"
          >
            <ArrowUp size={13} strokeWidth={1.75} />
          </button>
          
          {/* 其他按钮... */}
        </div>
      </div>
      
      {/* 面包屑导航 */}
      <TerminalBreadcrumb
        terminalId={terminalId}
        currentPath={currentPath}
        backend={backend}
        onNavigate={handleNavigate}
      />
      
      {/* 文件树内容 */}
      <div className="min-h-0 flex-1 overflow-auto py-0.5">
        {/* 现有文件树内容 */}
      </div>
    </div>
  )
}
```

### T3 路径跳转功能（P1 重要）

#### 3.5 路径输入框设计

添加可编辑的路径输入框，支持直接输入路径跳转：

**功能特性：**
- 点击面包屑激活路径输入模式
- 输入路径后按 Enter 跳转
- 支持绝对路径和相对路径
- 自动补全常用路径（~、.、..）
- 输入历史记录

#### 3.6 实现方案

```tsx
// 新增组件：PathInput.tsx
interface PathInputProps {
  terminalId: string
  currentPath: string
  backend: TerminalFileTreeBackend
  onNavigate: (path: string) => void
  onCancel: () => void
}

function PathInput({ terminalId, currentPath, backend, onNavigate, onCancel }: PathInputProps) {
  const [inputValue, setInputValue] = useState(currentPath)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    let path = inputValue.trim()
    
    // 处理特殊路径
    if (path === '~') {
      path = '/home/user' // 或从环境变量获取
    } else if (path === '..') {
      path = getParentPath(currentPath)
    } else if (path === '.') {
      path = currentPath
    }
    
    // 标准化路径
    path = normalizePath(path)
    
    onNavigate(path)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1 px-2 py-1">
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        className="flex-1 rounded border border-border px-2 py-0.5 text-caption bg-surface"
        placeholder="输入路径..."
      />
      <button
        type="submit"
        className="rounded p-1 text-ink-tertiary hover:bg-state-hover hover:text-ink"
      >
        <ArrowRight size={13} strokeWidth={1.75} />
      </button>
    </form>
  )
}
```

### T4 导航历史记录（P2 增强）

#### 3.7 历史记录功能

记录用户的导航历史，支持后退/前进：

**功能特性：**
- 记录最近访问的 50 个目录
- 后退/前进按钮
- 历史记录下拉菜单
- 书签功能（常用目录）

#### 3.8 状态管理扩展

```typescript
// 在 terminalFsStore.ts 中添加
interface TerminalFsSlice {
  // 现有字段...
  
  // 导航历史
  navigationHistory: string[]
  historyIndex: number
  bookmarks: Array<{ name: string; path: string }>
}

// 新增 action
interface TerminalFsStore {
  // 现有 action...
  
  // 导航历史
  pushHistory: (terminalId: string, path: string) => void
  goBack: (terminalId: string) => string | null
  goForward: (terminalId: string) => string | null
  addBookmark: (terminalId: string, name: string, path: string) => void
  removeBookmark: (terminalId: string, path: string) => void
}
```

### T5 快捷键支持（P1 重要）

#### 3.9 快捷键设计

| 快捷键 | 功能 | 说明 |
|--------|------|------|
| `Alt+↑` | 返回上一层 | 导航到父目录 |
| `Alt+←` | 后退 | 导航历史后退 |
| `Alt+→` | 前进 | 导航历史前进 |
| `Ctrl+L` | 聚焦路径栏 | 激活路径输入框 |
| `Enter` | 确认跳转 | 在路径输入框中确认 |
| `Escape` | 取消输入 | 取消路径输入 |

---

## 4. UI 设计

### 4.1 整体布局

```
┌─────────────────────────────────────────┐
│ [←] [↑] [→] [刷新] [上传] [路径输入...] │  ← 工具栏
├─────────────────────────────────────────┤
│ home > user > projects > current        │  ← 面包屑
├─────────────────────────────────────────┤
│ 📁 .git                                │
│ 📁 src                                 │
│ 📁 node_modules                        │
│ 📄 package.json                        │
│ 📄 README.md                           │
│ ...                                    │  ← 文件树
└─────────────────────────────────────────┘
```

### 4.2 交互流程

1. **返回上一层**
   - 点击 [↑] 按钮或按 `Alt+↑`
   - 文件树更新为父目录内容
   - 面包屑更新为父目录路径

2. **路径跳转**
   - 点击面包屑或按 `Ctrl+L`
   - 路径输入框获得焦点
   - 输入路径后按 Enter
   - 文件树更新为目标目录内容

3. **面包屑导航**
   - 点击面包屑中的某个路径片段
   - 文件树更新为该目录内容
   - 面包屑更新为该路径

---

## 5. 实现计划

### Phase 1：基础导航（P0）
1. 添加返回上一层按钮
2. 实现父目录导航逻辑
3. 添加面包屑导航组件

### Phase 2：路径跳转（P1）
1. 添加路径输入框组件
2. 实现路径解析和跳转
3. 添加快捷键支持

### Phase 3：历史记录（P2）
1. 扩展状态管理，添加历史记录
2. 实现后退/前进功能
3. 添加书签功能

### Phase 4：优化和测试（P2）
1. 性能优化（路径解析、历史记录）
2. 单元测试和集成测试
3. 用户测试和反馈收集

---

## 6. 测试策略

### 6.1 单元测试

```typescript
describe('TerminalFileTree Navigation', () => {
  it('should navigate to parent directory', () => {
    // 测试返回上一层功能
  })
  
  it('should navigate to absolute path', () => {
    // 测试路径跳转功能
  })
  
  it('should handle invalid paths gracefully', () => {
    // 测试错误处理
  })
  
  it('should update breadcrumb correctly', () => {
    // 测试面包屑更新
  })
})
```

### 6.2 集成测试

- 测试 SFTP 和本地文件系统的导航
- 测试导航历史记录
- 测试快捷键功能

### 6.3 用户测试

- 测试不同场景下的导航体验
- 收集用户反馈
- 优化交互设计

---

## 7. 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 路径解析错误 | 高 | 充分的单元测试，边界情况处理 |
| 性能问题 | 中 | 虚拟滚动，延迟加载 |
| 兼容性问题 | 中 | 充分的测试覆盖 |
| 用户体验不佳 | 中 | 用户测试，迭代优化 |

---

## 8. 成功指标

1. **功能完整性**
   - 支持返回上一层目录
   - 支持路径跳转
   - 支持面包屑导航

2. **用户体验**
   - 导航响应时间 < 100ms
   - 操作步骤减少 50%
   - 用户满意度 > 90%

3. **代码质量**
   - 测试覆盖率 > 80%
   - 无关键 bug
   - 代码可维护性良好

---

## 9. 参考资料

1. [VS Code 文件资源管理器 API](https://code.visualstudio.com/api/extension-guides/file-explorer)
2. [macOS Finder 用户指南](https://support.apple.com/guide/mac-help/use-the-finder-mchlp1774/mac)
3. [Windows 文件资源管理器](https://support.microsoft.com/windows/file-explorer-in-windows-10-ef381e44-4b63-4b22-9d28-8e4eb5d5eb6e)
4. [ranger 文件管理器](https://github.com/ranger/ranger)
