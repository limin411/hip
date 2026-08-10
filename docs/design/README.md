# docs/design 目录索引

按系列分目录，目录名 = 原文件名前缀；每个系列三件套：`*-spec.md`（规格）· `*-plan.md`（执行计划）· `*-preview.html`（高保真预览，浏览器直接打开）。

## 文档管理域（knowledge）

| 目录 | 业务 | 三件套 |
|---|---|---|
| `doc-editor-sidemenu-fix/` | 块编辑器侧边菜单修复（手柄 gutter/菜单项序） | `doc-editor-sidemenu-fix-{spec,plan,preview}` |
| `doc-block-menu-delete-row/` | 块菜单删除行整改（Turn into/Duplicate/删除） | `doc-block-menu-delete-row-{spec,plan,preview}` |
| `doc-notion-polish/` | 文档域 Notion 化整改（纸张子语言/视觉） | `doc-notion-polish-{spec,plan,preview}` |
| `doc-ux-polish-2/` | 操作交互与视觉体验第二弹 | `doc-ux-polish-2-{spec,plan,preview}` |
| `doc-terminal-capability-gap/` | 终端能力补齐（对照 alacritty 差距分析） | `terminal-capability-gap-spec.md` + `-plan.md`（P0 执行中）+ `terminal-capability-gap-preview.html`（高保真原型） |

## 约定

- 新系列文档：目录名沿用系列前缀（如 `chat-xxx/`、`memory-xxx/`），保持 `spec/plan/preview` 三件套。
- 系列内互相引用使用仓库根绝对路径（`docs/design/<series>/<file>`）。
