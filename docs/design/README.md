# docs/design 目录索引

按业务域分目录组织；每个系列三件套：`*-spec.md`（规格）· `*-plan.md`（执行计划）· `*-preview.html`（高保真预览，浏览器直接打开）。

## knowledge — 文档管理域

| 子目录 | 业务 | 系列 |
|---|---|---|
| `knowledge/editor/` | 块编辑器交互（手柄/侧边菜单/块菜单/气泡） | `doc-editor-sidemenu-fix-*`（侧边菜单修复）、`doc-block-menu-delete-row-*`（块菜单删除行） |
| `knowledge/polish/` | 文档域体验整改（Notion 化视觉 + 交互体验） | `doc-notion-polish-*`（Notion 化整改）、`doc-ux-polish-2-*`（操作交互与视觉第二弹） |

## 约定

- 新业务域文档：在 `docs/design/` 下新建对应子目录（如 `chat/`、`memory/`），保持 `spec/plan/preview` 三件套结构。
- 系列内互相引用使用仓库根绝对路径（`docs/design/<domain>/<series>-*.md`）。
