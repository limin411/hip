# hip 插件在 Windows 上加载失败 — 问题排查总结

## 背景

安装 [obra/superpowers](https://github.com/obra/superpowers) 插件到 hip 桌面版后，重启程序发现插件**没有被加载**。macOS 系统正常，Windows 系统不行。

---

## 问题一：Windows 数据目录不同

### 现象

插件安装在 `C:\Users\Admin\.hip\plugins\superpowers\`，但 hip 读不到。

### 根因

`packages/cli/src/sidecar/hip-base.ts` 中 `getBaseDir()` 函数：

```typescript
// Windows 路径
if (platform === 'win32') {
  const appData = env.APPDATA?.trim() || env.LOCALAPPDATA?.trim()
  return join(appData, 'com.ljm.hip')
}
// macOS 路径
return join(homeDir, '.hip')
```

| 平台 | 数据目录 | 说明 |
|------|----------|------|
| **macOS** | `~/.hip/` | HOME 目录下 `.hip` 文件夹 |
| **Windows** | `%APPDATA%\com.ljm.hip\` | `C:\Users\<用户>\AppData\Roaming\com.ljm.hip` |

之前一直修改的是 `~/.hip/`（macOS 路径），但 Windows 上 hip 实际读取的是 `%APPDATA%\com.ljm.hip\`。

### 修复

将插件复制到正确的 Windows 数据目录：

```
~/.hip/plugins/superpowers/
  → %APPDATA%\com.ljm.hip\plugins\superpowers\
```

---

## 问题二：hip-plugins.json 格式错误

### 现象

`plugins` 数组中的元素是对象格式，所有条目被静默跳过，返回空数组。

### 根因

`packages/sidecar/src/config/plugins.ts` 中 `readPluginsConfig()` 函数：

```typescript
for (const entry of arr) {
  if (typeof entry === 'string') {
    plugins.push(entry)
  } else {
    console.warn(`Skipping non-string plugin entry (${typeof entry}):`, entry)
  }
}
```

`plugins` 数组的每个元素**必须是字符串路径**（`"C:\\path\\to\\plugin"`），而之前存的是对象格式（`{ name: "...", path: "..." }`）。

所有对象条目被 `console.warn` 跳过 → 返回 `{ plugins: [] }` → 零插件被加载。

### 修复

```json
// 错误 ❌
{ "plugins": [{ "name": "superpowers", "path": "..." }] }

// 正确 ✅
{ "plugins": ["C:\\Users\\Admin\\AppData\\Roaming\\com.ljm.hip\\plugins\\superpowers"] }
```

---

## 问题三：`.plugin/plugin.json` 中 hooks 格式错误

### 现象

Parser 抛 `PluginManifestError`，导致**整个插件被跳过**。

### 根因

`packages/sidecar/src/session/plugins/parser.ts` 中 manifest 解析逻辑：

```typescript
if (typeof m.hooks === 'string') {
  hooks = resolveOne(m.hooks)          // ✅ string = 文件路径
} else if (Array.isArray(m.hooks)) {
  hooks = m.hooks as Hook[]            // ✅ Hook[] 数组
} else {
  throw new PluginManifestError(        // ❌ 对象 → 抛异常 → 跳过插件
    `hooks must be an array of configs or a string path, got ${typeof m.hooks}`,
  )
}
```

之前 `hooks` 是对象格式 `{"SessionStart": [...]}`，接受值只能是：
- **string**: 指向 hooks 配置文件的路径
- **Hook[]**: 直接内联的 Hook 配置数组

### 修复

```json
// 错误 ❌
{
  "hooks": {
    "SessionStart": [{ "matcher": "...", "hooks": [...] }]
  }
}

// 正确 ✅ — 引用外部 hooks.json 文件
{
  "hooks": "hooks/hooks.json"
}
```

---

## 问题四：`.plugin/plugin.json` 中 skills 路径缺少前缀

### 现象

Parser 解析 skills 路径时解析到不存在的目录。

### 根因

`parser.ts` 中 `resolveOne()` 函数相对 plugin 根目录解析：

```typescript
const absolute = resolve(pluginDir, value)  // resolve(".../superpowers", "brainstorming")
                                           // → ".../superpowers/brainstorming" ❌ 不存在
```

实际目录结构：

```
superpowers/
  .plugin/plugin.json
  skills/                  ← skills 都在这个子目录下
    brainstorming/
    test-driven-development/
    ...
```

所以 `"brainstorming"` 会解析成 `superpowers/brainstorming`（不存在），应该是 `superpowers/skills/brainstorming`。

### 修复

```json
// 错误 ❌
"skills": ["brainstorming", "test-driven-development", ...]

// 正确 ✅ — 加 skills/ 前缀
"skills": ["skills/brainstorming", "skills/test-driven-development", ...]
```

---

## 完整修复总结

| # | 问题 | 文件 | 修复 |
|---|------|------|------|
| 1 | **数据目录不对** | — | 复制插件到 `%APPDATA%\com.ljm.hip\plugins\superpowers\` |
| 2 | **plugins 数组格式错** | `config/hip-plugins.json` | `plugins` 数组用字符串路径，不用对象 |
| 3 | **hooks 格式非法** | `.plugin/plugin.json` | `hooks` 改为 `"hooks/hooks.json"`（string path） |
| 4 | **skills 路径缺前缀** | `.plugin/plugin.json` | 所有 skill 加 `skills/` 前缀 |

### 最终正确的文件内容

**`%APPDATA%\com.ljm.hip\config\hip-plugins.json`**:

```json
{"plugins":["C:\\Users\\Admin\\AppData\\Roaming\\com.ljm.hip\\plugins\\superpowers"],"enabled":{"superpowers":true}}
```

**`%APPDATA%\com.ljm.hip\plugins\superpowers\.plugin\plugin.json`**:

```json
{
  "name": "superpowers",
  "version": "6.1.1",
  "description": "Core skills library for coding agents...",
  "skills": [
    "skills/brainstorming",
    "skills/dispatching-parallel-agents",
    "skills/executing-plans",
    "skills/finishing-a-development-branch",
    "skills/receiving-code-review",
    "skills/requesting-code-review",
    "skills/subagent-driven-development",
    "skills/systematic-debugging",
    "skills/test-driven-development",
    "skills/using-git-worktrees",
    "skills/using-superpowers",
    "skills/verification-before-completion",
    "skills/writing-plans",
    "skills/writing-skills"
  ],
  "hooks": "hooks/hooks.json"
}
```

### 相关源码文件

| 文件 | 作用 |
|------|------|
| `packages/cli/src/sidecar/hip-base.ts` | 确定数据基目录（macOS vs Windows） |
| `packages/sidecar/src/config/plugins.ts` | 读取解析 `hip-plugins.json` |
| `packages/sidecar/src/session/plugins/parser.ts` | 解析 `.plugin/plugin.json` 清单 |
| `packages/sidecar/src/session/config-manager.ts` | 插件加载的总体流程编排 |
| `packages/sidecar/src/session/plugins/synthesizer.ts` | 插件数据聚合 |

---

> **教训**: hip 在 macOS 和 Windows 上的数据目录不同 (`~/.hip/` vs `%APPDATA%\com.ljm.hip\`)，插件安装/配置时务必确认所在平台对应的正确路径。
