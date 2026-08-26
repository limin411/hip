# docs/design 目录索引

按系列分目录，目录名 = 原文件名前缀。通常包含 `*-spec.md`（规格）与 `*-plan.md`（执行计划）；涉及视觉/交互的系列另有 `*-preview.html`（高保真预览，浏览器直接打开），无 UI 改动的系列不提供。

## 文档管理域（knowledge）

| 目录 | 业务 | 三件套 |
|---|---|---|
| `doc-editor-sidemenu-fix/` | 块编辑器侧边菜单修复（手柄 gutter/菜单项序） | `doc-editor-sidemenu-fix-{spec,plan,preview}` |
| `doc-block-menu-delete-row/` | 块菜单删除行整改（Turn into/Duplicate/删除） | `doc-block-menu-delete-row-{spec,plan,preview}` |
| `doc-notion-polish/` | 文档域 Notion 化整改（纸张子语言/视觉） | `doc-notion-polish-{spec,plan,preview}` |
| `doc-ux-polish-2/` | 操作交互与视觉体验第二弹 | `doc-ux-polish-2-{spec,plan,preview}` |
| `doc-browse-interaction/` | 文档管理浏览视图交互整改（选择/打开/组织分离、手柄多选、列头排序、新建置顶，对齐 Notion All pages） | `doc-browse-interaction-{spec,preview}`（plan 待评审后排期） |
| `knowledge-table/` | 文档管理新增「新建表格」（轻表格：类型化列 + 键盘导航 + 排序/筛选/统计） | `knowledge-table-{spec,plan,preview}`（preview 为全交互原型） |
| `table-ux-notion/` | 表格编辑器交互 Notion 化整改（焦点闭环/选区模型/复制粘贴/浮层 portal/行号视图一致性/视觉对齐） | `table-ux-notion-{spec,plan,preview}`（preview 为问题对照 + 新版全交互原型） |
| `table-right-panel/` | 表格 × 右侧面板关联性整改（表格不再被当文档渲染：表格信息面板/列清单↔表格联动/反链语义） | `table-right-panel-{spec,plan,preview}`（preview 为问题对照 + 右侧 rail 联动原型） |
| `doc-terminal-capability-gap/` | 终端能力补齐（对照 alacritty 差距分析） | `terminal-capability-gap-spec.md` + `-plan.md`（P0 已完成 2026-08-10，P1–P3 待排期）+ `terminal-capability-gap-preview.html`（高保真原型） |
| `terminal-shared-pty/` | 终端管理 · 运维助手共享终端能力整改（围栏完成信号 / 接管交还 / 排队 / 规则审批） | `terminal-shared-pty-{spec,plan,preview}`（P0–P1 已实施 2026-08-12：PR-0..5 全部落地，8058 单测 + 285 cargo 通过；剩余 P2 跟随项：上下文注入/TOCTOU 原子化） |
| `terminal-capability-upgrade/` | 终端能力现代化升级（WebGL 渲染 / 连字 / OSC 协议 / Sixel 图片 / 标签页 / 分屏 / 会话持久化） | `terminal-capability-upgrade-{spec,plan,preview}`（待评审；全面对标 Kitty/Alacritty/WezTerm 等现代终端） |

## 其它系列

| 目录 | 业务 | 文件 |
|---|---|---|
| `app-update-settings/` | 通用设置 · 版本查看 / 最新版本校验 / 自动检查更新（GitHub Releases；v1 下载安装器 + SHA-256，不接 tauri-plugin-updater） | `app-update-settings-{spec,plan,preview}`（草案；preview 为通用设置区块多状态交互原型） |
| `im-connectors/` | 设置 · IM 连接器（飞书 / 企业微信 / 钉钉官方机器人长连接，**双向对话**：IM 发消息→智能体执行→自动回复，HITL 交互卡片确认；无微信） | `im-connectors-{spec,plan,preview}`（实施中：PR-1 协议+存储+网关骨架、PR-2 飞书适配器+会话桥、PR-3 设置页 UI+i18n、PR-4 企微+钉钉适配器已落地；preview 为设置页多状态交互原型） |
| `agent-capability-upgrade/` | 内置智能体能力升级（长编程工程任务方向） | `agent-capability-upgrade-{spec,plan}`（草案待评审；无 UI 改动，无 preview） |
| `ui-enhancement-bui/` | 视觉与动效提升（参考 beautifului.dev：词块浮现 / 轨迹展开 / 工具行展开 / 等宽计时 / 点阵加载 / 列表 stagger） | `ui-enhancement-bui-{spec,preview}`（spec 含 19 组件差距映射 + P0–P2 分级提升项 + 实施计划与验收；preview 为现状 vs 提案对照 + 整窗整合演示，浏览器直接打开） |
| `doc-international-font-guide/` | 跨平台字体体系（拉丁打包 + CJK 系统回退） | `international_font_guide.md` + `international_font_plan.md`（计划待执行） |
| `doc-terminal-nerd-fonts/` | 终端内嵌 JetBrainsMono Nerd Font 子集 | `terminal_nerd_font_spec.md`（已实施） |

## 约定

- 新系列文档：目录名沿用系列前缀（如 `chat-xxx/`、`memory-xxx/`），按需提供 `spec/plan`（视觉类系列附 `preview`）。
- 系列内互相引用使用仓库根绝对路径（`docs/design/<series>/<file>`）。
