# 终端右侧面板文件图标升级方案（terminal-file-icons）

> 目标：连接终端（本地 term_fs / 远程 SFTP）右侧「文件管理」面板的条目图标，
> 从「统一灰色 File 图标」升级为项目场景（`artifact/FileTree.tsx`）同款
> 「类型图标 + 语义色编码 + 琥珀文件夹」。单 PR 交付。
>
> 交互预览：`preview.html`（同一目录，浏览器打开即可对比）。

## 背景：现状差异（检查结论）

| 项 | 项目场景 `artifact/FileTree.tsx` | 终端场景 `terminals/TerminalFileTree.tsx` | 差异 |
|----|--------------------------------|------------------------------------------|------|
| 文件图标 | `FileTypeIcon` → `fileIconForName(name)`（约 120 条扩展名 / 特殊文件名映射，语义色编码） | 固定 `<File size={14}>` + `text-ink-tertiary` | 所有文件一个样，纯灰 |
| 文件夹图标 | `Folder / FolderOpen`，`text-amber-600/80 dark:text-amber-400/90` | 同上灰 `text-ink-tertiary` | 文件夹无层级感 |
| 图标尺寸 | 15 | 14 | 略小 |

两个面板都是同一视觉语言（`bg-surface` + `rounded-md` 行 + `hover:bg-state-hover`），
只有图标这一环终端场景没接上 `src/lib/fileIcon.ts`（该项目场景专用，却与场景无关，
是通用工具——自带 `fileIcon.test.ts` 单测）。

## 方案：复用 fileIconForName，零新抽象

`fileIconForName` 已是 lib 层成熟工具。终端树只需在 `EntryRow` 内联调用，
**不**抽取共享组件、**不**动 `FileTree.tsx`（Surgical Changes：非坏代码不重构）。

### 改动点（仅 `TerminalFileTree.tsx` 一个文件）

1. 文件图标 → 类型图标（`EntryRow` 文件分支）：

```tsx
import { fileIconForName } from '@/lib/fileIcon'

// EntryRow 内，文件分支：
const { Icon, className } = fileIconForName(entry.name)
// ...
<Icon
  size={15}
  strokeWidth={1.75}
  className={cn('shrink-0', className)}
  data-testid="term-file-type-icon"
/>
```

2. 文件夹颜色对齐项目场景（`EntryRow` 目录分支 + 根 header 不动）：

```tsx
<FolderOpen size={15} strokeWidth={1.75} className="shrink-0 text-amber-600/80 dark:text-amber-400/90" />
<Folder    size={15} strokeWidth={1.75} className="shrink-0 text-amber-600/80 dark:text-amber-400/90" />
```

3. 其余保持现状：Chevron 13px、根 header `Folder size={13}`、行高 / padding 不变
   （终端面板更窄，行密度不因升级改变）。

### 兼容性说明

- 未匹配扩展名 → `fileIconForName` 返回 `{ Icon: File, className: text-ink-tertiary }`，
  与现状完全一致 → 无视觉回归。
- SFTP 与本地共用 `EntryRow`，一处改动两端生效；SFTP 条目仅用 `entry.name` 匹配，
  无额外 IPC / 类型字段。
- testid 用独立的 `term-file-type-icon`，不蹭项目场景的 `file-type-icon`
  （仓库先例：terminal-agent-parity 用 `terminal-interrupt` 避开 e2e 全局
  querySelector 歧义）。

## 测试

- 现有 `TerminalFileTree.sftpGate.test.tsx` / `TerminalFilesPanel.test.tsx` 无图标
  断言，不受影响（`TerminalFilesPanel.test.tsx` 还 mock 了整个 `TerminalFileTree`）。
- 新增冒烟（`TerminalFileTree` 渲染级）：同一棵树里 `main.ts` 与 `logo.png`
  渲染的 `term-file-type-icon` className 不同且含期望色（sky / fuchsia）；
  `mystery.xyzzy` 仍为 `text-ink-tertiary`。色值本身由 `fileIcon.test.ts` 已覆盖，
  不重复。

## 验收标准

1. 本地终端 + SFTP 右侧面板：文件图标与项目场景同扩展名 → 同图标、同颜色。
2. 文件夹为琥珀色（含展开态 `FolderOpen`），与项目场景一致。
3. 深浅主题下对比度达标（色板沿用 fileIcon.ts 已验证的 light/dark 对）。
4. `yarn test` 全绿，无既有用例回归。
