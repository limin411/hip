# MCP 服务器改名为外部工具服务并改为网格卡片

## 背景

设置页面的「MCP 服务器」功能需要改名为「外部工具服务」，并且服务器列表从现有的横向卡片列表改为网格卡片布局，与智能体管理页面的卡片网格风格保持一致。

## 目标

1. 将所有用户可见的「MCP 服务器」文案替换为「外部工具服务」（中文）/ "External Tool Services"（英文）/ "外部工具服務"（繁体中文）。
2. 将 `McpConfig` 中的服务器列表从纵向列表改为响应式网格卡片布局。
3. 保持现有功能（启用/禁用、编辑、删除、重连、工具管理）不变。

## 不在范围

- 不改代码中的变量名、类型名、store 字段、协议字段（仍使用 `mcp` 等内部标识）。
- 不改 i18n key 名（仍使用 `settings.mcp.*`）。
- 不新增功能或修改业务逻辑。

## 文案替换清单

在 `src/i18n/zh-CN.ts`、`src/i18n/zh-TW.ts`、`src/i18n/en.ts` 中替换以下文案值（保持 key 不变）：

| Key | 原中文 | 新中文 | 新英文 | 新繁体中文 |
|-----|--------|--------|--------|------------|
| `settings.mcpLabel` | MCP 服务器 | 外部工具服务 | External Tool Services | 外部工具服務 |
| `settings.mcp.title` | MCP 服务器 | 外部工具服务 | External Tool Services | 外部工具服務 |
| `settings.mcp.empty` | 还没有 MCP 服务器。添加一个以扩展 hip 的外部工具。 | 还没有外部工具服务。添加一个以扩展 hip 的外部工具。 | No external tool services yet. Add one to extend hip with external tools. | 還沒有外部工具服務。新增一個以擴充 hip 的外部工具。 |
| `settings.mcp.editTitle` | 编辑 MCP 服务器 | 编辑外部工具服务 | Edit external tool service | 編輯外部工具服務 |
| `settings.mcp.addTitle` | 添加 MCP 服务器 | 添加外部工具服务 | Add external tool service | 新增外部工具服務 |
| `settings.mcp.namePlaceholder` | 我的 MCP 服务器 | 我的外部工具服务 | My external tool service | 我的外部工具服務 |
| `settings.mcp.deleteConfirmBody` | 这会移除该 MCP 服务器配置。之后可以重新添加。 | 这会移除该外部工具服务配置。之后可以重新添加。 | This removes the external tool service configuration. It can be added again later. | 這會移除該外部工具服務設定。之後可以重新新增。 |
| `settings.mcp.pluginSectionTitle` | 插件 MCP 服务器 | 插件外部工具服务 | Plugin external tool services | 外掛外部工具服務 |
| `settings.agents.toolMcpServers` | MCP 服务器 | 外部工具服务 | External tool services | 外部工具服務 |
| `settings.agents.toolMcpServersEmpty` | 尚未配置任何 MCP 服务器 | 尚未配置任何外部工具服务 | No external tool services configured yet | 尚未設定任何外部工具服務 |
| `settings.plugins.componentCounts` | …{{mcpServers}} 个 MCP… | …{{mcpServers}} 个外部工具服务… | …{{mcpServers}} external tool services… | …{{mcpServers}} 個外部工具服務… |
| `settings.mcp.intro` | 接入 Model Context Protocol 服务器… | 接入外部工具服务，其工具会合并进 hip 主智能体… | Connect external tool services. Their tools are merged into the hip agent… | 接入外部工具服務，其工具會合併進 hip 主智能體… |

## 卡片网格设计

### 容器

将 `McpConfig` 中「我的服务器」和「插件外部工具服务」两个列表容器从 `space-y-2` 改为：

```tsx
<div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
  ...
</div>
```

空状态保持现有居中带图标的 dashed 按钮样式，但文案替换。

### McpServerCard 网格样式

参考 `AgentCard` 的 grid view，将 `McpServerCard` 改为垂直卡片：

- 顶部：图标（Plug）、名称、传输方式 Badge、状态（带 StatusDot）
- 中部：命令/url（截断）、工具数量、管理工具按钮
- 底部：启用 Switch + 操作按钮（重连、编辑、删除）
- 固定最小高度，hover 阴影与 AgentCard 一致
- 禁用时整体透明度降低

### PluginMcpServerCard 网格样式

同样改为垂直卡片，保留「via 插件名」Badge，去掉操作按钮（插件提供的工具服务只读）。

### 工具展开面板

保留在卡片内部展开工具列表的交互，但在网格布局下占用卡片内部空间，不影响网格。

## 预期结果

- 设置侧边栏、页面标题、弹窗、空状态均显示「外部工具服务」。
- 服务器列表以网格卡片展示，与智能体管理页面风格一致。
- 所有现有功能（添加、编辑、删除、启用、重连、工具管理）继续可用。

## 验证

- TypeScript 编译通过。
- 单元测试通过。
- 手动检查三语言文案和网格布局。
