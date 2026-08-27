# BUG 修复：输入无效路径后无法回退

## 问题描述

**BUG：** 用户输入一个无效路径时，无法回退到原来的正确路径。

**复现步骤：**
1. 打开终端文件面板
2. 点击路径输入按钮（或按 Ctrl+L）
3. 输入一个不存在的路径（如 `/invalid/path`）
4. 按 Enter 确认
5. 尝试点击"返回上一层"或"后退"按钮

**预期行为：** 应该能够回退到原来的正确路径

**实际行为：** 无法回退，卡在无效路径上

## 根因分析

问题在于 `navigateTo` 函数的实现：

```typescript
// 问题代码
const navigateTo = useCallback((path: string) => {
  useTerminalFsStore.getState().setRootPath(terminalId, path)  // 立即更新
  useTerminalFsStore.getState().pushNavigation(terminalId, path)
  load(path)  // 异步加载，但不检查结果
}, [terminalId, load])
```

**问题：**
1. `setRootPath` 立即更新了 `rootPath` 为无效路径
2. `load` 函数是异步的，加载失败时会设置错误，但不会恢复 `rootPath`
3. 用户看到的是无效路径，但无法回退

## 修复方案

修改 `navigateTo` 函数，添加错误恢复逻辑：

```typescript
// 修复后的代码
const navigateTo = useCallback(async (path: string) => {
  const store = useTerminalFsStore.getState()
  const oldPath = store.byTerminal[terminalId]?.rootPath ?? null
  
  // Update rootPath immediately for UI feedback
  store.setRootPath(terminalId, path)
  store.pushNavigation(terminalId, path)
  
  try {
    // Try to load the directory
    if (backend === 'local') {
      await loadLocalDir(terminalId, path || '.')
    } else {
      await loadSftpDir(terminalId, path)
    }
    
    // After loading, get fresh state to check results
    const freshState = useTerminalFsStore.getState()
    const slice = freshState.byTerminal[terminalId]
    
    // Check if loading succeeded by looking at entries
    const entries = slice?.entriesByDir[path]
    const hasEntries = entries && entries.length > 0
    
    // If no entries were loaded, check for errors
    if (!hasEntries) {
      const currentError = slice?.error
      const currentDirError = slice?.dirErrors?.[path]
      
      // If there's an error, navigation failed - restore old path
      if (currentError || currentDirError) {
        if (oldPath) {
          freshState.setRootPath(terminalId, oldPath)
        }
      }
    }
  } catch (e) {
    // Navigation failed, restore old path
    if (oldPath) {
      useTerminalFsStore.getState().setRootPath(terminalId, oldPath)
    }
  }
}, [terminalId, backend])
```

**修复要点：**
1. 保存旧路径 `oldPath`
2. 立即更新 `rootPath` 为新路径（提供即时 UI 反馈）
3. 异步加载目录内容
4. 加载完成后检查结果：
   - 如果有条目加载成功，导航成功
   - 如果没有条目且有错误，导航失败，恢复旧路径
5. 如果发生异常，恢复旧路径

## 测试验证

### 测试用例 1：输入无效路径
1. 打开终端文件面板
2. 输入 `/invalid/path`
3. 按 Enter
4. 验证：应该显示错误，并且可以点击"后退"回到原路径

### 测试用例 2：输入有效路径
1. 打开终端文件面板
2. 输入有效路径（如 `/tmp`）
3. 按 Enter
4. 验证：应该导航到 `/tmp`，并可以点击"后退"回到原路径

### 测试用例 3：使用返回上一层
1. 打开终端文件面板
2. 点击"返回上一层"按钮
3. 验证：应该导航到父目录

### 测试用例 4：使用后退/前进
1. 打开终端文件面板
2. 导航到多个目录
3. 点击"后退"按钮
4. 验证：应该回到上一个目录
5. 点击"前进"按钮
6. 验证：应该前进到下一个目录

## 代码变更

**文件：** `src/components/terminals/TerminalFileTree.tsx`

**变更：**
1. 修改 `navigateTo` 函数，添加错误恢复逻辑
2. 修改 `goBack` 和 `goForward` 函数，使用 `navigateTo` 函数
3. 修改 `navigateToParent` 函数，使用 `navigateTo` 函数

**影响范围：**
- 终端文件面板的导航功能
- 后退/前进功能
- 返回上一层功能
- 路径跳转功能

## 提交信息

```
fix: restore previous path when navigation fails

When navigating to an invalid path, the rootPath was updated immediately
but not restored when the navigation failed. This fix:

- Saves the old path before navigation
- Restores old path if navigation fails (no entries loaded + error present)
- Prevents users from getting stuck on invalid paths
- Allows back/forward navigation to work correctly after failed navigation

Fixes: unable to return to correct path after entering invalid path
```

**提交哈希：** `02c05ee7`

**状态：** ✅ 已修复并提交
