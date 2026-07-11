# 模型配置三类分离 · 布局设计

**日期：** 2026-07-11  
**状态：** 已评审（brainstorm 确认）  
**范围：** 设置 → 模型配置 的信息架构与 UI 重组；记忆抽取选型迁入记忆页

## 问题

当前「模型配置」单页混合了：

1. 当前对话模型 Hero  
2. 「专用模型」区块（记忆抽取 + 嵌入 + 重排下拉）  
3. 提供商列表 + 详情（密钥、Base URL、模型、设为当前）

三类用途不同的模型配置挤在同一滚动视图，职责不清；嵌入/重排也缺少与基础模型对等的提供商管理入口。

## 目标

1. **按用途拆分配置面**：基础模型、嵌入向量模型、重排模型互不混排。  
2. **记忆抽取不单独做端点配置**：从已配置的基础 chat 模型池中选型。  
3. **嵌入 / 重排可独立管理提供商**：密钥、Base URL、自定义提供商 UI 与基础模型 tab 同级完整。  
4. **最小后端改动**：本轮以 UI 与交互重组为主，不迁移存储路径。

## 非目标（本轮不做）

- 设置左侧导航拆成多个一级入口（「基础模型 / 嵌入 / 重排」三项）  
- 二级折叠导航  
- 按 modality 硬过滤 models.dev catalog（catalog 无统一 embedding/rerank 标记）  
- 真正接入 cross-encoder rerank HTTP API（配置位与透传行为保持现状）  
- 将 `embeddingModel` / `rerankModel` / `extractModel` 迁出 `memory.json` 到 `hip.toml`  
- 同一 `providerID` 维护三套互斥密钥  

## 决策摘要

| 议题 | 决定 |
|------|------|
| 导航结构 | **方案 A**：侧栏仍为「模型配置」；页内 `SegmentedControl` 切换三类 |
| 记忆抽取 | 迁到 **记忆** 设置；**仅从基础模型池下拉选型**，不单独配密钥/端点 |
| 嵌入 / 重排能力 | 各自 tab 具备完整提供商管理 UI（密钥、Base URL、启用、自定义） |
| 提供商注册表 | **共享** `providers` + `auth.json` 密钥；按用途分别记录「当前选型」 |
| 存储 | 字段归属不变，只搬家 UI |

## 信息架构

```
设置
├── 通用
├── 模型配置          ← 仍为单一侧栏项
│   ├── [基础模型]    ← SegmentedControl
│   ├── [嵌入]
│   └── [重排]
├── 智能体
├── …
└── 记忆
    └── … + 记忆抽取模型（下拉，从基础模型池）
```

页内状态：本地 `useState` 或 `uiStore` 可选记录上次 tab（实现阶段二选一；默认本地 state 即可）。

## 各 Tab 内容

### 共同骨架

每个 tab 结构一致：

1. **Hero** — 当前该用途选型（空态 / 就绪 / 密钥缺失）  
2. **左侧 ProviderList** — 搜索、已配置/可用/不兼容、添加自定义  
3. **右侧 ProviderDetail** — API Key、Base URL、启用、模型列表  

差异仅在 Hero 文案与「设为当前」语义。

### 基础模型

| 项 | 行为 |
|----|------|
| Hero | 当前对话模型（现有 `CurrentModelHero`） |
| 主操作 | 「设为当前」→ `ProvidersConfig.activeModel`（`hip.toml`） |
| 模型列表 | Chat 模型（含推理/工具/视觉等现有徽章） |
| 说明 | 管理对话与 agent 使用的全局模型池；记忆抽取也从此池选型 |

### 嵌入

| 项 | 行为 |
|----|------|
| Hero | 当前嵌入模型；未设置时空态提示「混合检索需配置」 |
| 主操作 | 「设为嵌入模型」→ `MemoryFileConfig.embeddingModel` |
| 推荐 | 保留「使用推荐」（OpenAI 兼容 + `text-embedding-3-small`） |
| 清除 | 允许清空（关闭混合检索依赖时） |
| 说明 | 文案强调：嵌入会将记忆文本发往所选 API；混合检索开关仍在记忆页 |

### 重排

| 项 | 行为 |
|----|------|
| Hero | 当前重排模型；未设置 = 跳过重排（合法空态） |
| 主操作 | 「设为重排模型」/「清除」→ `MemoryFileConfig.rerankModel` |
| 说明 | 可选；当前 sidecar 若尚未接真实 rerank API，UI 仍允许配置，行为与现网一致 |

### 记忆页 · 抽取模型

| 项 | 行为 |
|----|------|
| 控件 | 单一 `<select>`（或等价） |
| 选项 | 「默认（当前活动提供商的廉价模型）」+ `groupModelOptions(catalog, config)` |
| 写入 | `MemoryFileConfig.extractModel`（`MemoryModelRef` 或清空为默认） |
| **不提供** | API Key、Base URL、独立自定义提供商入口 |
| 端点解析 | 使用基础模型提供商已配置的 key / baseURL（与现有 `resolveBaseURL` 一致） |

从 `ModelConfig` **删除** 整块 `role-models-section`（extract + embedding + rerank 三连下拉）。

## 提供商与密钥策略

### 共享注册表

- `HipConfig.providers` / `ProvidersConfig.providers`：启用状态、Base URL、自定义元数据  
- `~/.hip/config/auth.json`：按 `providerID` 存密钥  
- 同一提供商（如 OpenAI）可同时被基础模型与嵌入选用  

### 「独立管理」的含义

用户选择的是 **每个用途都有完整配置 UI**，以及 **可添加专用自定义提供商**（如仅用于 embedding 的 Voyage/Jina 端点），而不是三套隔离的密钥命名空间。

- 在「嵌入」tab 添加的自定义提供商进入 **同一** providers 注册表，其他 tab 也能看到。  
- `MemoryModelRef.baseURL` 可在写入时带上解析后的 baseURL（与现逻辑一致），用于专用端点覆盖。  
- **不** 实现「同一 providerID 对话密钥 vs 嵌入密钥」双写。

### 模型列表过滤

本轮 **不** 按 modality 硬过滤 catalog（无可靠统一字段）。可选软引导：

- 嵌入 tab 说明推荐模型 id / 「使用推荐」按钮  
- 重排 tab 说明可选与当前未接入 API 的行为  

后续若 catalog 或用户自定义标记完善，再加过滤。

## 数据归属（不变）

| 字段 | 存储 | UI 位置 |
|------|------|---------|
| `activeModel` | `hip.toml` | 模型配置 → 基础模型 |
| `embeddingModel` | `memory.json` | 模型配置 → 嵌入 |
| `rerankModel` | `memory.json` | 模型配置 → 重排 |
| `extractModel` | `memory.json` | 记忆 |
| `providers` / keys | `hip.toml` + `auth.json` | 三个 tab 共用管理 UI |

Sidecar 读写路径本轮不变；`sessionService.getMemoryConfig` / `setMemoryConfig` 与 `providersStore` 继续服务各自字段。

## 组件与文件影响（实现指引）

| 区域 | 变更 |
|------|------|
| `ModelConfig.tsx` | 顶部分段控件；按 tab 渲染；移除 role-models 区块；嵌入/重排走 memory config 读写 |
| 可抽取 | `ProviderWorkspace`（或等价）：列表+详情，参数化「设为当前」回调与文案 |
| `CurrentModelHero.tsx` | 支持用途变体文案（对话 / 嵌入 / 重排）与空态 |
| `MemoryConfig.tsx` | 新增抽取模型下拉（自 ModelConfig 迁入逻辑） |
| `MemoryConfig` 文案 | 混合检索「请先在模型 → 嵌入配置」类提示对齐新 IA |
| i18n | `en` / `zh-CN` / `zh-TW`：tab 标签、Hero、按钮、记忆页 extract 区块 |
| 测试 | 更新/补充 ModelConfig 与 MemoryConfig 相关单测；e2e 若依赖 `role-models-section` 需改选择器 |

## 交互细节

1. **Tab 切换**不卸载已加载的 providers store；memory config 在进入嵌入/重排时确保已 refresh。  
2. **添加自定义提供商**后选中该提供商，停留在当前 tab。  
3. **嵌入「使用推荐」**失败条件与现网一致：活动 chat 提供商非 OpenAI 兼容时 toast 说明。  
4. **记忆页 extract** 在 providers 未 load 时 disable 下拉。  
5. 记忆页 hybrid 开关旁的「需先配置嵌入」链接/文案指向 **模型配置 → 嵌入**，不再写「角色模型」。

## 验收标准

1. 模型配置页无「专用模型」三连下拉；页顶可切换基础 / 嵌入 / 重排。  
2. 基础 tab 可设置 `activeModel`；行为与现网一致。  
3. 嵌入 tab 可设置/清除/推荐 `embeddingModel`，并可配置密钥与 Base URL。  
4. 重排 tab 可设置/清除 `rerankModel`，并可配置密钥与 Base URL。  
5. 记忆页可选择/清除 `extractModel`，选项来自基础模型池，无独立密钥 UI。  
6. 三语言文案齐全；相关单测通过。

## 风险与后续

| 风险 | 缓解 |
|------|------|
| 用户在嵌入 tab 误选 chat 模型 id | 文案 + 推荐按钮；后续 modality 过滤 |
| 共享注册表让「专用 embedding 提供商」出现在基础模型列表 | 可接受；自定义提供商用户本就跨用途；日后可加 provider 用途标签 |
| Rerank API 未实现却可配置 | 保持现状说明；不在本轮扩大 sidecar 范围 |

**后续可选：**

- catalog / 自定义模型 `kind: chat | embedding | rerank`  
- 将 embed/rerank 当前选型提升到 `hip.toml` 与 `activeModel` 并列  
- 真实 rerank HTTP 客户端  

## 参考（brainstorm）

- 方案对比 mockup：`.superpowers/brainstorm/*/content/layout-approaches.html`  
- 用户确认：布局 A、嵌入/重排独立管理 UI、extract 迁记忆且仅从基础池选型  
