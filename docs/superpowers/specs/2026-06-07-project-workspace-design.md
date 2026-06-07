# Project Workspace：选择项目目录 · 文件树 · 文件预览

**Date**: 2026-06-07
**Status**: Approved（设计已确认，待 spec 复审）

## 目标

把 deepagents 的「真实文件系统」能力接入 hip：用户为每个会话选择一个真实的**项目目录**，
Agent（Supervisor + Planner/Coder/Reviewer）在该目录内**真实读写文件**，UI 在右侧
Artifact 面板提供**文件树浏览**与**文件预览**（Markdown / HTML / 图片渲染，代码/文本只读查看）。

这是 `backend-mvp` 与 `remediation-phase2`（"sub-agents are reasoning-only, no real file/exec
tools this phase"）刻意推迟的下一步：把 `createDeepAgent({ backend })` 真正接上
`FilesystemBackend`。

## 已确认的关键决策

| # | 决策 | 选择 |
|---|------|------|
| 1 | 选目录的核心目标 | **Agent 真实读写该目录**（接 deepagents `FilesystemBackend`），文件树/预览实时反映真实改动 |
| 2 | 目录归属范围 | **每个 session 独立绑定**（`SessionConfig.cwd`，随会话持久化/恢复） |
| 3 | 树与文档的布局/联动 | **`Files` 改为左树右预览的分栏**；预览支持 **HTML / Markdown / 图片**；**删除 `doc` 标签与 `DocRenderer`** |
| 4 | 写操作安全模型 | **沙箱内自主读写**（`virtualMode` 锁在 cwd 内，禁 `../`/`~`；不逐次确认） |
| 5 | FS 数据来源（UI） | **方案 A：Sidecar 经 WS 提供**（前端不直读盘、无需 webview fs 权限；与 Agent 同进程、同 cwd、同磁盘） |
| 6 | 测试 | **尽兴真机 E2E**（WebdriverIO + `@wdio/tauri-service` 驱动真实 `hip.app`）覆盖确定性 FS/UI 流程；真实 LLM 写盘走手动 GUI 验收 |

## 架构与数据流

```
用户点「选择项目文件夹」
   │ Tauri 原生 dialog（新增 plugin-dialog）
   ▼
前端 open({ directory: true }) → 绝对路径 cwd
   │ session:setCwd { sessionId, cwd }
   ▼
Sidecar  Session.setCwd(cwd)
         ├─ new FilesystemBackend({ rootDir: cwd, virtualMode: true }) → 重建 agent（保留 this.messages 历史）
         └─ 持久化：更新 config blob（cwd 进 SessionConfig）
   │ session:cwd（确认）
   ▼
前端 SessionVM.cwd 写入 → Files 标签显示树
   │ fs:ls { path: cwd }                 点文件 → fs:read { path }
   ▼                                            ▼
Sidecar workspace-fs.lsDir(cwd, cwd) ─fs:ls:result→ 树   workspace-fs.readForPreview ─fs:read:result→ 预览

Agent 回合写文件（FilesystemBackend，同一 cwd） ─message:complete→ 前端重拉已展开目录 + 重读当前文件
```

**两个 FS 使用者、同一真相源**：Agent 的工具走 deepagents `FilesystemBackend(rootDir=cwd)`；
UI 浏览走 sidecar 内一个**专用 Node-fs 读取器** `workspace-fs.ts`。两者都在 sidecar 进程内、
都锚定同一个 cwd、读同一块磁盘，因此 UI 所见 == Agent 所改。UI 读取不复用
`FilesystemBackend` 的原因：其 `read()` 给文本加行号、对二进制（图片）按文本处理不可靠；
专用读取器能精确控制 文本/二进制 与 mimeType，并独立设预览大小上限。

## 改动范围

| 文件 | 改动 |
|------|------|
| `packages/protocol/src/index.ts` | `SessionConfig.cwd?`；新增 `FsEntry`；新增 `session:setCwd`/`fs:ls`/`fs:read` 客户端消息与 `session:cwd`/`fs:ls:result`/`fs:read:result` 服务端消息 |
| `packages/sidecar/src/session/workspace-fs.ts` | **新增**：`resolveWithin(cwd, abs)`、`lsDir`、`readForPreview`（Node `fs/promises`，沙箱+二进制+mime） |
| `packages/sidecar/src/session/session.ts` | `buildAgent()` 抽取；`cwd` 时注入 `FilesystemBackend`；新增 `setCwd`/`lsDir`/`readForPreview` |
| `packages/sidecar/src/session/session-manager.ts` | 新增 `session:setCwd`/`fs:ls`/`fs:read` 分支；`setCwd` 后持久化 config |
| `packages/sidecar/src/persistence/store.ts` | `updateConfig(sessionId, configJson)`（cwd 存入既有 config blob，**无需 schema 迁移**） |
| `src-tauri/Cargo.toml` / `capabilities/default.json` | 加 `tauri-plugin-dialog`；权限 `dialog:allow-open` |
| `src-tauri/src/lib.rs` | `.plugin(tauri_plugin_dialog::init())` |
| `package.json` | 加 `@tauri-apps/plugin-dialog` |
| `src/domain/sessionStore.ts` | `SessionVM.cwd`；`apply()` 处理 `session:cwd`；动作驱动 |
| `src/domain/sessionService.ts` | `setProjectDir`/`lsDir`/`readFile` 动作 |
| `src/store/fsStore.ts` | **新增**：按 sessionId 缓存 `entriesByDir / expanded / activePath / preview / loading` |
| `src/ipc/dialog.ts` | **新增**：`pickDirectory()` 包装 Tauri dialog（含测试缝） |
| `src/store/uiStore.ts` | `ArtifactTab` 去掉 `'doc'` |
| `src/components/artifact/ArtifactPanel.tsx` | 删 `doc` 标签；`Files` 内嵌分栏 |
| `src/components/artifact/FileTree.tsx` | 接真实树：懒加载、空态选目录、头部项目名+刷新 |
| `src/components/artifact/FilePreview.tsx` | **新增**：按类型渲染（md/html/image/text/二进制兜底） |
| `src/components/artifact/DocRenderer.tsx` | **删除**（prose 样式迁入 FilePreview 的 markdown 分支） |
| `src/i18n/*` | 新增文案 key（选目录、空态、过大、无法预览、刷新等），三语 |
| `e2e/fixtures/sample-project/` | **新增**：确定性夹具（README.md、index.html、小 png、nested/a.ts） |
| `e2e/specs/project-workspace.spec.ts` | **新增**：真机 E2E |

## 协议层 `@hip/protocol`

```ts
export interface SessionConfig {
  llmProvider: 'deepseek'
  model: string
  tools: string[]
  systemPrompt?: string
  cwd?: string                 // 绝对项目根；无则保持虚拟 FS（现状）
}

export interface FsEntry {
  name: string                 // basename
  path: string                 // 真实绝对路径，例 '/Users/me/foo/src/main.ts'
  isDir: boolean
  size?: number
}

// Client → Server
| { type: 'session:setCwd'; sessionId: string; cwd: string }
| { type: 'fs:ls';   sessionId: string; path: string }
| { type: 'fs:read'; sessionId: string; path: string }

// Server → Client
| { type: 'session:cwd';    sessionId: string; cwd: string }
| { type: 'fs:ls:result';   sessionId: string; path: string; entries: FsEntry[]; error?: string }
| { type: 'fs:read:result'; sessionId: string; path: string;
    content?: string; encoding: 'utf8' | 'base64'; mimeType?: string;
    truncated?: boolean; error?: string }
```

**路径约定**：协议层一律用**真实绝对路径**（宿主路径，如 `/Users/me/foo/src/main.ts`）。
`fs:ls { path: cwd }` 列项目根，子项 path = `join(cwd, name)`。

> **两种路径表示、同一批磁盘文件**：UI/协议用绝对路径；Agent 工具内部仍用 `virtualMode` 的虚拟
> 路径（`/src/main.ts`，强沙箱）。原因：deepagents `FilesystemBackend` 的 `virtualMode:false`
> 会"按原样允许绝对路径" = 拆掉沙箱，违背决策 4，故 Agent 侧**必须** `virtualMode:true`。两种表示
> 都落到 `cwd` 下的同一批文件——UI 读取走 `workspace-fs`（绝对路径 + `resolveWithin` 沙箱），
> Agent 走 `FilesystemBackend`（虚拟路径沙箱），互不依赖、无需互转（刷新只重拉树，不做路径映射）。

## Sidecar 设计

### `workspace-fs.ts`（新增，UI 浏览专用读取器）

```ts
// 沙箱解析：规范化绝对路径 abs，断言落在 cwd 内，越界即抛
resolveWithin(cwd: string, abs: string): string
// 列目录（非递归），目录在前、按名排序；条目 path = join(dirAbs, name) 绝对路径
// （MVP 不过滤 node_modules，靠懒加载控量）
lsDir(cwd: string, dirAbs: string): Promise<FsEntry[]>
// 预览读取：按扩展名判 文本/图片/二进制
//   文本（md/html/代码/txt…）→ utf8，超 TEXT_CAP(1MB) 截断 + truncated
//   图片（png/jpg/jpeg/gif/svg/webp）→ base64 + mimeType，超 IMG_CAP(5MB) → error('过大')
//   其它二进制 → 不返回 content（前端兜底「无法预览」）
readForPreview(cwd: string, abs: string): Promise<{ content?; encoding; mimeType?; truncated? } | { error }>
```

`resolveWithin`：`path.resolve(abs)` 规范化后断言 `r === cwd || r.startsWith(cwd + sep)`，否则抛——
第二道沙箱防线（防 `..` 注入、防绝对路径越界到 cwd 外）。

### `session.ts`

- 把 agent 构建抽成 `private buildAgent(): void`，由构造器与 `setCwd` 调用。
- `cwd` 存在时：
  ```ts
  import { createDeepAgent, FilesystemBackend } from 'deepagents'
  const backend = new FilesystemBackend({ rootDir: this.config.cwd, virtualMode: true, maxFileSizeMb: 10 })
  this.agent = createDeepAgent({ model, systemPrompt, subagents: SUBAGENTS, backend })
  // sub-agents 继承 backend → 自动获得真实 ls/read/write/edit/glob/grep
  ```
  `cwd` 不存在 → 不传 `backend`（deepagents 默认 `StateBackend` 虚拟 FS，行为同今天）。
- `setCwd(cwd)`：更新内部 config → 调 `buildAgent()`。**前置改造**：构造器的 `readonly config`
  改为可变私有字段并暴露 `get config()`（session-manager 持久化时要读回最新 config）。`this.messages`
  历史不动（history 在 `streamEvents` 调用时传入，与 agent 实例解耦），故重建无损上下文。
- `lsDir(abs)` / `readForPreview(abs)`：委派 `workspace-fs`（绝对路径），无 cwd 时返回 error。
- 更新 `SUPERVISOR_PROMPT`：告知子代理可用真实文件工具，且**其工具路径相对项目根**（Agent 侧
  `virtualMode`，与 UI 的绝对路径表示无关）。

### `session-manager.ts`

```ts
case 'session:setCwd': {
  const s = this.ensureSession(msg.sessionId)
  s.setCwd(msg.cwd)                                    // 重建带 backend 的 agent
  this.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))  // 读回最新 config 持久化
  send({ type: 'session:cwd', sessionId: msg.sessionId, cwd: msg.cwd })
  break
}
case 'fs:ls': {
  const r = await this.ensureSession(msg.sessionId).lsDir(msg.path)
  send({ type: 'fs:ls:result', sessionId: msg.sessionId, path: msg.path, ...r })
  break
}
case 'fs:read': {
  const r = await this.ensureSession(msg.sessionId).readForPreview(msg.path)
  send({ type: 'fs:read:result', sessionId: msg.sessionId, path: msg.path, ...r })
  break
}
```

`ensureSession`（lazy rehydrate）解析 config blob 时自动带出 `cwd` → 重建带 backend 的 agent。

## Tauri：原生目录选择器

- `Cargo.toml`：`tauri-plugin-dialog = "2"`；`lib.rs`：`.plugin(tauri_plugin_dialog::init())`。
- `capabilities/default.json` permissions 加 `"dialog:allow-open"`。
- `package.json`：`@tauri-apps/plugin-dialog`。
- 这是本特性**唯一**要动 Rust 的地方（仅注册插件，无自定义 command）。

## 前端 domain

- `SessionVM.cwd?: string`；`sessionStore.apply()` 处理 `session:cwd`（写入对应 session 的 cwd）。
- `sessionService`：
  - `setProjectDir(id, cwd)` → 乐观写 store + 清空该 session 的 `fsStore` 缓存（避免旧树残留）+ 发 `session:setCwd`。
  - `lsDir(sessionId, path)` / `readFile(sessionId, path)` → 发 `fs:ls`/`fs:read`。
  - `receive()` 把 `fs:ls:result`/`fs:read:result` 灌进 `fsStore`。
- `fsStore`（新增，轻量、易失缓存）：`Record<sessionId, { entriesByDir, expanded:Set, activePath, preview, loading }>`。
  树/预览是**可重取缓存**，不进 domain store；cwd 是会话真相、留在 SessionVM 并持久化。

## 前端 UI

### `ipc/dialog.ts`
```ts
export async function pickDirectory(): Promise<string | null> {
  // 测试缝：E2E 注入 window.__hipPickDir 返回夹具路径，绕过原生 dialog（wdio 点不到 OS 对话框）
  if (window.__hipPickDir) return window.__hipPickDir()
  const { open } = await import('@tauri-apps/plugin-dialog')
  const r = await open({ directory: true, multiple: false })
  return typeof r === 'string' ? r : null
}
```

### `ArtifactPanel.tsx`
- `TABS` 去掉 `doc` → `[files, agents, diff]`。
- `Files` 内容区改为 `react-resizable-panels` 横向分栏：左 `FileTree`（min ~30%），右 `FilePreview`。
  （`react-resizable-panels` 已是依赖、AppLayout 已在用。）

### `FileTree.tsx`
- 绑定 `useActiveSession().cwd`：
  - 无 cwd → 空态：文件夹图标 + 「选择项目文件夹」按钮 → `pickDirectory()` → `setProjectDir`。
  - 有 cwd → 头部显示项目名（basename）+「更换」「刷新」；下方懒加载树。
- 懒加载：展开目录时若 `entriesByDir[path]` 未缓存则 `lsDir`；点文件 → 设 `activePath` 并 `readFile`。
- `message:complete`（活动 session）后：重拉所有 `expanded` 目录 + 重读 `activePath`（刷新策略）。

### `FilePreview.tsx`（新增）
按 `mimeType`/扩展名选择渲染：
| 类型 | 渲染 |
|------|------|
| Markdown | `ReactMarkdown` + 迁移自 DocRenderer 的 prose 样式 |
| HTML | `<iframe sandbox srcDoc={content} />`（**空 sandbox** = 禁脚本/禁同源，防被预览文件执行） |
| 图片 | `<img src={`data:${mimeType};base64,${content}`} />` |
| 文本/代码 | 等宽 `<pre>`（语法高亮属后续，YAGNI）；`truncated` 时顶部提示「仅显示前 1MB」 |
| 二进制/`error` | 居中占位：「无法预览」/「文件过大」+ 文件名/大小 |
| 未选文件 | 占位：「从左侧选择文件查看」 |

## 安全模型（决策 4：沙箱内自主读写）

- `FilesystemBackend({ virtualMode: true })`：Agent 全部路径锁在 cwd 内，`../`/`~` 逃逸被 backend 拒绝。
- `workspace-fs.resolveWithin`：UI 读取的第二道沙箱防线。
- 写操作不逐次确认；改动通过文件树/预览可见（决策 4）。
- HTML 预览用空 `sandbox` iframe，杜绝预览内容执行脚本/读取应用上下文。
- 协议层走真实绝对路径（含 cwd）；`workspace-fs.resolveWithin` 确保 UI 读取不越出 cwd。Agent 侧
  仍 `virtualMode`（虚拟路径、强沙箱）——两种表示指向 cwd 下同一批磁盘文件。

## 刷新策略（MVP）

- 触发点：活动 session 的 `message:complete` → 重拉已展开目录 + 重读当前文件。
- 头部「刷新」按钮手动兜底。
- **不做** `fs.watch` 实时监听（YAGNI，留后续增量）。

## 持久化

- `cwd` 进既有 `SessionConfig`（config blob，JSON）。`createSession` 时若已选则带入；
  `session:setCwd` 时 `store.updateConfig` 重写 blob。**无 schema 迁移**（沿用 schema v2）。
- `ensureSession` 解析 blob 即恢复 cwd → 重建带 backend 的 agent。

## 测试策略

> 取向：**确定性的 FS/UI 流程尽兴上真机 E2E**（不花 API）；**真实 LLM 写盘**走手动 GUI 验收
> （契合既有偏好：GUI 验真实 DeepSeek，不跑烧钱的自动化）。两者不矛盾——E2E 覆盖的都是
> 不触 LLM 的确定路径。

### 真机 E2E（`e2e/specs/project-workspace.spec.ts`，WebdriverIO 驱动真实 `hip.app`）
夹具 `e2e/fixtures/sample-project/`（README.md、index.html、20×20 png、`nested/a.ts`）。
通过测试缝 `window.__hipPickDir` 把 cwd 指向夹具绝对路径（native dialog wdio 点不到）。覆盖：
1. 跳过登录 → 新建会话 → 打开右面板 → 选目录 → 文件树渲染出夹具顶层条目。
2. 展开 `nested/` → 懒加载出 `a.ts`。
3. 点 `README.md` → 右侧 Markdown 渲染（断言渲染出标题文本，非源码）。
4. 点 `index.html` → iframe 预览存在且 `sandbox` 受限。
5. 点 png → `<img>` 的 `src` 为 `data:image/png;base64,...`。
6. 点 `a.ts` → 等宽源码可见。
7. 越界防护：构造 `fs:read { path:'/etc/passwd' }`（cwd 之外的绝对路径，经 `window` 暴露的动作）→ 收到 `error`，无内容泄漏。
8. 切到另一个未选目录的会话 → Files 回到空态（验证 per-session 绑定）。

### 单元测试（Vitest，不触 LLM）
- `workspace-fs`：临时目录里 `lsDir` 排序/`isDir`（条目为绝对路径）；`readForPreview` 文本/图片/二进制/过大分支；`resolveWithin` 拒 cwd 外绝对路径与 `..` 逃逸。
- `session.setCwd`：注入 fake model，断言重建 agent 后 `this.messages` 历史保留；无 cwd 时 `lsDir` 返回 error。
- `FilePreview`：按 mimeType 选择渲染分支（md/html/image/text/二进制）。
- 协议：类型编译通过（`yarn type-check` + `yarn workspace @hip/sidecar type-check`）。

### 手动 GUI 验收（真实 DeepSeek，一次性）
配好 key → 选一个真实小项目 → 让 Agent「创建 hello.ts 并写一行」→ 观察：sub-agent 调
`write_file` → 回合结束后文件树自动出现 `hello.ts` → 点开预览内容正确 → 真实磁盘确有该文件。

## 明确不做（YAGNI）

预览内编辑（只读）· 代码语法高亮（先等宽）· `fs.watch` 实时监听 · Diff 标签接真实文件 ·
单 session 多根/工作区 · 树内搜索/重命名/删除/新建文件 · `node_modules` 等忽略规则（靠懒加载控量）·
目录选择器记忆最近路径。

## 验收标准

- [ ] 选目录后 sub-agents 能真实读写该目录（手动 GUI 验收：Agent 写出的文件出现在真实磁盘与文件树）。
- [ ] 文件树懒加载真实目录；点文件预览 Markdown/HTML/图片/文本各正确。
- [ ] `doc` 标签与 `DocRenderer` 已删除；`Files` 为左树右预览分栏。
- [ ] cwd 随会话持久化，重启/恢复会话后仍指向同一目录。
- [ ] 沙箱生效：`..`/`~` 逃逸被拒（E2E + 单测）。
- [ ] 真机 E2E `project-workspace.spec.ts` 全绿；`yarn type-check`、两端 type-check、`yarn test` 全绿。
